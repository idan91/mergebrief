import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterEach, describe, expect, it } from "vitest";

const MIGRATIONS_FOLDER = fileURLToPath(new URL("../drizzle", import.meta.url));
const MARKS_REFS_TAG = "marks-span-refs";
const NARRATIVE_SKIPPED_TAG = "narrative-skipped";
/** Two migrations from an empty PGlite, which v8 coverage slows past the default. */
const MIGRATE_TWICE_TIMEOUT_MS = 30_000;

interface Journal {
  readonly entries: readonly { readonly tag: string }[];
}

const openClients: PGlite[] = [];
const tempFolders: string[] = [];

afterEach(async () => {
  await Promise.all(openClients.splice(0).map((client) => client.close()));
  await Promise.all(
    tempFolders.splice(0).map((folder) => rm(folder, { recursive: true })),
  );
});

async function makeFolderBefore(tag: string): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), "mb-marks-refs-"));
  tempFolders.push(folder);
  await cp(MIGRATIONS_FOLDER, folder, { recursive: true });

  const journalPath = join(folder, "meta", "_journal.json");
  const journal = JSON.parse(await readFile(journalPath, "utf8")) as Journal;
  const cut = journal.entries.findIndex((entry) => entry.tag.endsWith(tag));
  expect(cut).toBeGreaterThan(0);
  await writeFile(
    journalPath,
    JSON.stringify({ ...journal, entries: journal.entries.slice(0, cut) }),
  );
  return folder;
}

/**
 * PR 1 has base `main9` and two Briefs at `h1` (a retarget re-brief, the
 * higher index on `main2`) plus one at `h2`; `chk` is a Checkpoint SHA with
 * no Brief. PR 2 has no base and no Brief at `x1`. The delta at `chk..h2`
 * came after every Brief; the one at `old..h2` came before `h2`'s Brief, as
 * did the narrative at `stale..h2`; the narrative at `h1..h2` came after.
 */
async function seedMarksOnPreviousSchema(client: PGlite): Promise<void> {
  await client.exec(`
    insert into pull_request (installation_id, repo_id, pr_number, state, base_sha)
      values (1, 11, 1, 'open', 'main9'), (1, 11, 2, 'open', null);
    insert into brief (installation_id, pull_request_id, base_sha, head_sha, head_index, commit_count, provider, model, effort, used_group_ids, body_version, body, byte_size)
      select 1, id, 'main1', 'h1', 1, 1, 'p', 'm', 'e', '{}'::text[], 1, '{}', 2 from pull_request where pr_number = 1
      union all
      select 1, id, 'main2', 'h1', 2, 1, 'p', 'm', 'e', '{}'::text[], 1, '{}', 2 from pull_request where pr_number = 1
      union all
      select 1, id, 'main3', 'h2', 3, 1, 'p', 'm', 'e', '{}'::text[], 1, '{}', 2 from pull_request where pr_number = 1;
    insert into comparison_marks (installation_id, pull_request_id, baseline_sha, head_sha, body, byte_size)
      select 1, id, 'h1', 'h2', '{}', 2 from pull_request where pr_number = 1
      union all
      select 1, id, 'chk', 'h2', '{}', 2 from pull_request where pr_number = 1
      union all
      select 1, id, 'old', 'h2', '{}', 2 from pull_request where pr_number = 1
      union all
      select 1, id, 'stale', 'h2', '{}', 2 from pull_request where pr_number = 1
      union all
      select 1, id, 'x1', 'x2', '{}', 2 from pull_request where pr_number = 2;
    insert into delta (installation_id, pull_request_id, baseline_sha, head_sha, provider, model, effort, body_version, body, byte_size, created_at)
      select 1, id, 'chk', 'h2', 'p', 'm', 'e', 1, '{}', 2, now() + interval '1 hour' from pull_request where pr_number = 1
      union all
      select 1, id, 'old', 'h2', 'p', 'm', 'e', 1, '{}', 2, now() - interval '1 hour' from pull_request where pr_number = 1;
    insert into revision_narrative (installation_id, pull_request_id, brief_id, prev_head_sha, head_sha, provider, model, effort, body_version, body, byte_size, created_at)
      select 1, pull_request_id, id, 'h1', 'h2', 'p', 'm', 'e', 1, '{}', 2, now() + interval '1 hour' from brief where head_sha = 'h2'
      union all
      select 1, pull_request_id, id, 'stale', 'h2', 'p', 'm', 'e', 1, '{}', 2, now() - interval '1 hour' from brief where head_sha = 'h2';
  `);
}

describe("marks span refs migration", () => {
  it(
    "backfills each side's base and deletes rows it cannot certify",
    async () => {
      const client = new PGlite();
      openClients.push(client);
      await migrate(drizzle(client), {
        migrationsFolder: await makeFolderBefore(MARKS_REFS_TAG),
      });
      await seedMarksOnPreviousSchema(client);

      await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });

      const result = await client.query<{
        baseline_sha: string;
        prev_base_sha: string;
        new_base_sha: string;
      }>(
        "select baseline_sha, prev_base_sha, new_base_sha from comparison_marks order by baseline_sha",
      );
      expect(result.rows).toEqual([
        { baseline_sha: "chk", prev_base_sha: "main9", new_base_sha: "main3" },
        { baseline_sha: "h1", prev_base_sha: "main2", new_base_sha: "main3" },
      ]);
    },
    MIGRATE_TWICE_TIMEOUT_MS,
  );
});

const TOO_LARGE_BODY = JSON.stringify({
  artifactKind: "revisionNarrativeSkipped",
  skipped: "span too large",
});
const DISABLED_BODY = JSON.stringify({
  artifactKind: "revisionNarrativeSkipped",
  skipped: "disabled by config",
});
/** As the categorizer writes a body and ingest stores it: pretty-printed. */
const PRETTY_BODY = JSON.stringify(
  { artifactKind: "revisionNarrativeSkipped", skipped: "span too large" },
  undefined,
  2,
);

describe("narrative skipped migration", () => {
  it(
    "stamps every skip record and no other narrative",
    async () => {
      const client = new PGlite();
      openClients.push(client);
      await migrate(drizzle(client), {
        migrationsFolder: await makeFolderBefore(NARRATIVE_SKIPPED_TAG),
      });
      await client.exec(`
        insert into pull_request (installation_id, repo_id, pr_number, state, base_sha)
          values (1, 11, 1, 'open', 'main9');
        insert into brief (installation_id, pull_request_id, base_sha, head_sha, head_index, commit_count, provider, model, effort, used_group_ids, body_version, body, byte_size)
          select 1, pull_request.id, 'main9', 'h' || n, n, 1, 'p', 'm', 'e', '{}'::text[], 1, '{}', 2
          from pull_request, generate_series(1, 4) as n;
      `);
      await client.query(
        `insert into revision_narrative (installation_id, pull_request_id, brief_id, prev_head_sha, head_sha, provider, model, effort, body_version, body, byte_size)
          select 1, pull_request_id, id, 'p' || head_index, head_sha, 'p', 'm', 'e', 1,
            case head_index when 1 then $1 when 2 then $2 when 4 then $3 else '{"overview":"x"}' end, 2
          from brief`,
        [TOO_LARGE_BODY, DISABLED_BODY, PRETTY_BODY],
      );

      await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });

      const result = await client.query<{
        prev_head_sha: string;
        skipped: boolean;
      }>(
        "select prev_head_sha, skipped from revision_narrative order by prev_head_sha",
      );
      expect(result.rows).toEqual([
        { prev_head_sha: "p1", skipped: true },
        { prev_head_sha: "p2", skipped: true },
        { prev_head_sha: "p3", skipped: false },
        { prev_head_sha: "p4", skipped: true },
      ]);
    },
    MIGRATE_TWICE_TIMEOUT_MS,
  );
});
