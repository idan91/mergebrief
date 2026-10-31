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
const ROW_RUNS_TAG = "0080_chunk-layout-row-runs";
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

function cutBefore(
  entries: readonly JournalEntry[],
  tag: string,
): JournalEntry[] {
  const cut = entries.findIndex((entry) => entry.tag === tag);
  expect(cut).toBeGreaterThan(0);
  return entries.slice(0, cut);
}

function dropChunkLayout(entries: readonly JournalEntry[]): JournalEntry[] {
  return cutBefore(entries, CHUNK_LAYOUT_TAG);
}

function dropRowRuns(entries: readonly JournalEntry[]): JournalEntry[] {
  return cutBefore(entries, ROW_RUNS_TAG);
}

const STALE_COUNTS = {
  rows: 3,
  hunkRows: 1,
  expandRows: 0,
  splitRows: 3,
  lineWidths: { counts: [2, 0, 0, 0, 0, 0, 0, 0, 0], overflowColumns: 0 },
};
const CURRENT_COUNTS = { ...STALE_COUNTS, rowRuns: "h1c1a1" };
const LAYOUT_BODIES = {
  "outline-only": {
    chunks: { c1: { ...STALE_COUNTS, outline: "h1c1a1" } },
    files: {},
  },
  "stale-file": {
    chunks: { c1: CURRENT_COUNTS },
    files: { "a.ts": STALE_COUNTS },
  },
  current: {
    chunks: { c1: CURRENT_COUNTS },
    files: { "a.ts": CURRENT_COUNTS },
  },
  empty: { chunks: {}, files: {} },
};

async function seedLayouts(client: PGlite): Promise<void> {
  await client.exec(`
    insert into pull_request (installation_id, repo_id, pr_number, state)
      values (1, 11, 1, 'open');
  `);
  for (const [index, [head, body]] of Object.entries(LAYOUT_BODIES).entries()) {
    const text = JSON.stringify(body);
    await client.query(
      `with inserted as (
         insert into brief (installation_id, pull_request_id, base_sha, head_sha, head_index, commit_count, provider, model, effort, used_group_ids, body_version, body, byte_size)
         select 1, id, 'base', $1, $3, 1, 'p', 'm', 'e', '{}', 2, '{}', 2 from pull_request
         returning id, pull_request_id
       )
       insert into chunk_layout (installation_id, pull_request_id, brief_id, body, byte_size)
         select 1, pull_request_id, id, $2, length($2) from inserted`,
      [head, text, index + 1],
    );
  }
}

function backdateChunkLayout(entries: readonly JournalEntry[]): JournalEntry[] {
  return cutBefore(entries, ROW_RUNS_TAG).map((entry) =>
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

describe("chunk layout row runs migration", () => {
  it(
    "removes the layouts holding counts without row runs and keeps the rest",
    async () => {
      const client = await openMigrated(
        await makeFolderWithJournal(dropRowRuns),
      );
      await seedLayouts(client);

      await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });

      const kept = await client.query<{ head_sha: string }>(
        "select brief.head_sha from chunk_layout join brief on brief.id = chunk_layout.brief_id order by brief.head_sha",
      );
      expect(kept.rows.map((row) => row.head_sha)).toEqual([
        "current",
        "empty",
      ]);
    },
    MIGRATE_TWICE_TIMEOUT_MS,
  );
});
