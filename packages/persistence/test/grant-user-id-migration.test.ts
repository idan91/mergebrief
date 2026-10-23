import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterEach, describe, expect, it } from "vitest";

const MIGRATIONS_FOLDER = fileURLToPath(new URL("../drizzle", import.meta.url));
const GRANT_USER_ID_TAG = "grant-user-id";
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

async function makeFolderBeforeGrantUserId(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), "mb-grant-user-id-"));
  tempFolders.push(folder);
  await cp(MIGRATIONS_FOLDER, folder, { recursive: true });

  const journalPath = join(folder, "meta", "_journal.json");
  const journal = JSON.parse(await readFile(journalPath, "utf8")) as Journal;
  const cut = journal.entries.findIndex((entry) =>
    entry.tag.endsWith(GRANT_USER_ID_TAG),
  );
  expect(cut).toBeGreaterThan(0);
  await writeFile(
    journalPath,
    JSON.stringify({ ...journal, entries: journal.entries.slice(0, cut) }),
  );
  return folder;
}

async function seedCredentialsOnPreviousSchema(client: PGlite): Promise<void> {
  await client.exec(`
    insert into github_grant (gh_token_ciphertext, gh_refresh_token_ciphertext, key_ref, refresh_expires_at)
      values ('v1.access', 'v1.refresh', 'SESSION_KEY_V1', now() + interval '1 day');
    insert into auth_session (session_token_hash, reviewer_id, grant_id, expires_at)
      select 'session-hash', 7, id, now() + interval '1 day' from github_grant;
    insert into api_token (token_hash, user_id, name, scope, grant_id)
      select 'token-hash', 7, 'ci', 'external-write', id from github_grant;
  `);
}

async function countRows(client: PGlite, table: string): Promise<number> {
  const result = await client.query<{ count: number }>(
    `select count(*)::int as count from ${table}`,
  );
  return result.rows[0]?.count ?? -1;
}

describe("grant user id migration", () => {
  it(
    "wipes existing credential rows before adding the user column",
    async () => {
      const client = new PGlite();
      openClients.push(client);
      await migrate(drizzle(client), {
        migrationsFolder: await makeFolderBeforeGrantUserId(),
      });
      await seedCredentialsOnPreviousSchema(client);

      await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });

      expect(await countRows(client, "auth_session")).toBe(0);
      expect(await countRows(client, "api_token")).toBe(0);
      expect(await countRows(client, "github_grant")).toBe(0);
    },
    MIGRATE_TWICE_TIMEOUT_MS,
  );
});
