import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterEach, describe, expect, it } from "vitest";

const MIGRATIONS_FOLDER = fileURLToPath(new URL("../drizzle", import.meta.url));
const CHUNK_LAYOUT_TAG = "0079_chunk-layout";
/** The `when` 0079 first shipped under, below 0077's and 0078's. */
const BACKDATED_CHUNK_LAYOUT_WHEN = 1793196754706;
/** Two migrations from an empty PGlite, which v8 coverage slows past the default. */
const MIGRATE_TWICE_TIMEOUT_MS = 30_000;

interface JournalEntry {
  readonly tag: string;
  readonly when: number;
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

async function makeFolderWithJournal(
  rewrite: (entries: readonly JournalEntry[]) => readonly JournalEntry[],
): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), "mb-chunk-layout-"));
  tempFolders.push(folder);
  await cp(MIGRATIONS_FOLDER, folder, { recursive: true });

  const journalPath = join(folder, "meta", "_journal.json");
  const journal = JSON.parse(await readFile(journalPath, "utf8")) as Journal;
  expect(journal.entries.map((entry) => entry.tag)).toContain(CHUNK_LAYOUT_TAG);
  await writeFile(
    journalPath,
    JSON.stringify({ ...journal, entries: rewrite(journal.entries) }),
  );
  return folder;
}

function dropChunkLayout(entries: readonly JournalEntry[]): JournalEntry[] {
  return entries.filter((entry) => entry.tag !== CHUNK_LAYOUT_TAG);
}

function backdateChunkLayout(entries: readonly JournalEntry[]): JournalEntry[] {
  return entries.map((entry) =>
    entry.tag === CHUNK_LAYOUT_TAG
      ? { ...entry, when: BACKDATED_CHUNK_LAYOUT_WHEN }
      : entry,
  );
}

async function openMigrated(folder: string): Promise<PGlite> {
  const client = new PGlite();
  openClients.push(client);
  await migrate(drizzle(client), { migrationsFolder: folder });
  return client;
}

async function readChunkLayoutTable(client: PGlite): Promise<string | null> {
  const result = await client.query<{ table: string | null }>(
    "select to_regclass('public.chunk_layout')::text as table",
  );
  return result.rows[0]?.table ?? null;
}

describe("chunk layout migration", () => {
  it(
    "creates chunk_layout on a database migrated past 0078 first",
    async () => {
      const client = await openMigrated(
        await makeFolderWithJournal(dropChunkLayout),
      );
      expect(await readChunkLayoutTable(client)).toBeNull();

      await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });

      expect(await readChunkLayoutTable(client)).toBe("chunk_layout");
    },
    MIGRATE_TWICE_TIMEOUT_MS,
  );

  it(
    "re-runs over a chunk_layout applied under the backdated when",
    async () => {
      const client = await openMigrated(
        await makeFolderWithJournal(backdateChunkLayout),
      );
      expect(await readChunkLayoutTable(client)).toBe("chunk_layout");

      await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });

      const indexes = await client.query<{ indexname: string }>(
        "select indexname from pg_indexes where tablename = 'chunk_layout' order by indexname",
      );
      expect(indexes.rows.map((row) => row.indexname)).toEqual([
        "chunk_layout_brief_id_key",
        "chunk_layout_pkey",
        "chunk_layout_pull_request_idx",
      ]);
      const constraints = await client.query<{ conname: string }>(
        "select conname from pg_constraint where conrelid = 'chunk_layout'::regclass and contype = 'f' order by conname",
      );
      expect(constraints.rows.map((row) => row.conname)).toEqual([
        "chunk_layout_brief_id_brief_id_fk",
        "chunk_layout_pull_request_id_pull_request_id_fk",
      ]);
    },
    MIGRATE_TWICE_TIMEOUT_MS,
  );
});
