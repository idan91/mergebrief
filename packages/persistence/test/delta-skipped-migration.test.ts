import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterEach, describe, expect, it } from "vitest";

const MIGRATIONS_FOLDER = fileURLToPath(new URL("../drizzle", import.meta.url));
const DELTA_SKIPPED_TAG = "delta-skipped";
/** Two migrations from an empty PGlite, which v8 coverage slows past the default. */
const MIGRATE_TWICE_TIMEOUT_MS = 30_000;

interface JournalEntry {
  readonly tag: string;
}

interface Journal {
  readonly entries: readonly JournalEntry[];
}

const openClients: PGlite[] = [];
const tempFolders: string[] = [];

afterEach(async () => {
  await Promise.all(openClients.splice(0).map((client) => client.close()));
  await Promise.all(
    tempFolders.splice(0).map((folder) => rm(folder, { recursive: true })),
  );
});

async function makeFolderBeforeDeltaSkipped(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), "mb-delta-skipped-"));
  tempFolders.push(folder);
  await cp(MIGRATIONS_FOLDER, folder, { recursive: true });

  const journalPath = join(folder, "meta", "_journal.json");
  const journal = JSON.parse(await readFile(journalPath, "utf8")) as Journal;
  const cut = journal.entries.findIndex((entry) =>
    entry.tag.endsWith(DELTA_SKIPPED_TAG),
  );
  expect(cut).toBeGreaterThan(0);
  await writeFile(
    journalPath,
    JSON.stringify({ ...journal, entries: journal.entries.slice(0, cut) }),
  );
  return folder;
}

async function seedDeltasOnPreviousSchema(client: PGlite): Promise<void> {
  await client.exec(`
    insert into pull_request (installation_id, repo_id, pr_number, state)
      values (1, 11, 1, 'open');
    insert into delta (installation_id, pull_request_id, baseline_sha, head_sha, provider, model, effort, body_version, body, byte_size)
      select 1, id, 'chk', 'skip', 'p', 'm', 'e', 2, '{"pr":{},"artifactKind":"deltaSkipped"}', 1 from pull_request
      union all
      select 1, id, 'chk', 'brief', 'p', 'm', 'e', 2, '{"summary":"s","changedGroups":[]}', 1 from pull_request
      union all
      select 1, id, 'chk', 'broken', 'p', 'm', 'e', 2, '{"broken":true}', 1 from pull_request;
  `);
}

describe("delta skipped migration", () => {
  it(
    "flags the skip records already stored and only them",
    async () => {
      const client = new PGlite();
      openClients.push(client);
      await migrate(drizzle(client), {
        migrationsFolder: await makeFolderBeforeDeltaSkipped(),
      });
      await seedDeltasOnPreviousSchema(client);

      await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });

      const result = await client.query<{ head_sha: string; skipped: boolean }>(
        "select head_sha, skipped from delta order by head_sha",
      );
      expect(result.rows).toEqual([
        { head_sha: "brief", skipped: false },
        { head_sha: "broken", skipped: false },
        { head_sha: "skip", skipped: true },
      ]);
    },
    MIGRATE_TWICE_TIMEOUT_MS,
  );
});
