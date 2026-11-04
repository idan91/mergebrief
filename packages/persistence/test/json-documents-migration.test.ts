import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterEach, describe, expect, it } from "vitest";
import { cleanJsonText } from "../src/db/json-text";

const MIGRATIONS_FOLDER = fileURLToPath(new URL("../drizzle", import.meta.url));
const STORED_JSON_TAG = "stored-json-documents";
/** Two migrations from an empty PGlite, which v8 coverage slows past the default. */
const MIGRATE_TWICE_TIMEOUT_MS = 30_000;
const REPLACEMENT = String.fromCodePoint(0xfffd);

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

async function makeFolderBeforeStoredJson(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), "mb-stored-json-"));
  tempFolders.push(folder);
  await cp(MIGRATIONS_FOLDER, folder, { recursive: true });

  const journalPath = join(folder, "meta", "_journal.json");
  const journal = JSON.parse(await readFile(journalPath, "utf8")) as Journal;
  const cut = journal.entries.findIndex((entry) =>
    entry.tag.endsWith(STORED_JSON_TAG),
  );
  expect(cut).toBeGreaterThan(0);
  await writeFile(
    journalPath,
    JSON.stringify({ ...journal, entries: journal.entries.slice(0, cut) }),
  );
  return folder;
}

async function openPreviousSchema(): Promise<PGlite> {
  const client = new PGlite();
  openClients.push(client);
  await migrate(drizzle(client), {
    migrationsFolder: await makeFolderBeforeStoredJson(),
  });
  await client.exec(
    `insert into pull_request (installation_id, repo_id, pr_number, state) values (1, 11, 1, 'open')`,
  );
  return client;
}

async function seedBrief(
  client: PGlite,
  head: string,
  index: number,
  body: string,
  repoConfig: string | null = null,
): Promise<void> {
  await client.query(
    `insert into brief (installation_id, pull_request_id, base_sha, head_sha, head_index, commit_count, provider, model, effort, used_group_ids, body_version, body, byte_size, repo_config)
     select 1, id, 'base', $1, $2, 1, 'p', 'm', 'e', '{}', 2, $3, 1, $4 from pull_request`,
    [head, index, body, repoConfig],
  );
}

function migrateToHead(client: PGlite): Promise<void> {
  return migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });
}

type DocumentKey =
  | "brief.body"
  | "brief.repo_config"
  | "chunk_layout.body"
  | "comparison_marks.body"
  | "delta.body"
  | "generation.repo_config"
  | "generation_part.body"
  | "hunk_span.spans"
  | "revision_narrative.body";

const OBJECT_DOCUMENTS: readonly DocumentKey[] = [
  "brief.body",
  "brief.repo_config",
  "chunk_layout.body",
  "comparison_marks.body",
  "delta.body",
  "generation.repo_config",
  "generation_part.body",
  "revision_narrative.body",
];

/** One row in every table holding a document, each overridable by column. */
async function seedEveryDocument(
  client: PGlite,
  overrides: Partial<Record<DocumentKey, string>>,
): Promise<void> {
  function read(key: DocumentKey): string {
    return overrides[key] ?? (key === "hunk_span.spans" ? "[]" : "{}");
  }

  await seedBrief(
    client,
    "h1",
    1,
    read("brief.body"),
    read("brief.repo_config"),
  );
  await client.query(
    `insert into chunk_layout (installation_id, pull_request_id, brief_id, body, byte_size)
     select 1, pull_request_id, id, $1, 1 from brief`,
    [read("chunk_layout.body")],
  );
  await client.query(
    `insert into comparison_marks (installation_id, pull_request_id, baseline_sha, head_sha, prev_base_sha, new_base_sha, body, byte_size)
     select 1, id, 'h0', 'h1', 'b', 'b', $1, 1 from pull_request`,
    [read("comparison_marks.body")],
  );
  await client.query(
    `insert into delta (installation_id, pull_request_id, baseline_sha, head_sha, provider, model, effort, body_version, body, byte_size)
     select 1, id, 'h0', 'h1', 'p', 'm', 'e', 2, $1, 1 from pull_request`,
    [read("delta.body")],
  );
  await client.query(
    `insert into generation (installation_id, pull_request_id, kind, head_sha, status, repo_config)
     select 1, id, 'brief', 'h1', 'succeeded', $1 from pull_request`,
    [read("generation.repo_config")],
  );
  await client.query(
    `insert into generation_part (installation_id, pull_request_id, base_sha, head_sha, part_key, body, byte_size)
     select 1, id, 'b', 'h1', 'grouping', $1, 1 from pull_request`,
    [read("generation_part.body")],
  );
  await client.query(
    `insert into hunk_span (installation_id, pull_request_id, baseline_sha, head_sha, spans)
     select 1, id, 'h0', 'h1', $1 from pull_request`,
    [read("hunk_span.spans")],
  );
  await client.query(
    `insert into revision_narrative (installation_id, pull_request_id, brief_id, prev_head_sha, head_sha, provider, model, effort, body_version, body, byte_size)
     select 1, pull_request_id, id, 'h0', 'h1', 'p', 'm', 'e', 2, $1, 1 from brief`,
    [read("revision_narrative.body")],
  );
}

async function readDocument(
  client: PGlite,
  key: DocumentKey,
): Promise<string[]> {
  const [table, column] = key.split(".");
  const rows = await client.query<{ value: string }>(
    `select "${column}" as value from "${table}"`,
  );
  return rows.rows.map((row) => row.value);
}

describe("stored JSON documents migration", () => {
  it(
    "rewrites only the escapes a jsonb cast refuses",
    async () => {
      const client = await openPreviousSchema();
      const cases: readonly (readonly [string, string])[] = [
        [String.raw`{"a":"x\u0000y"}`, `{"a":"x${REPLACEMENT}y"}`],
        [
          String.raw`{"a":"\u0000\u0000"}`,
          `{"a":"${REPLACEMENT}${REPLACEMENT}"}`,
        ],
        [String.raw`{"a":"cut\ud83d"}`, `{"a":"cut${REPLACEMENT}"}`],
        [String.raw`{"a":"cut\uD83D"}`, `{"a":"cut${REPLACEMENT}"}`],
        [String.raw`{"a":"\ude00"}`, `{"a":"${REPLACEMENT}"}`],
        [
          String.raw`{"a":"\\\u0000"}`,
          `{"a":"${String.raw`\\`}${REPLACEMENT}"}`,
        ],
        [
          String.raw`{"a":"\\ud83d\ude00"}`,
          `{"a":"${String.raw`\\`}ud83d${REPLACEMENT}"}`,
        ],
        [
          String.raw`{"a":"\ud83d\\ude00"}`,
          `{"a":"${REPLACEMENT}${String.raw`\\`}ude00"}`,
        ],
        [
          String.raw`{"a":"\u0000","a":"ok"}`,
          `{"a":"${REPLACEMENT}","a":"ok"}`,
        ],
        [String.raw`{ "a":  "\u0000" }`, `{ "a":  "${REPLACEMENT}" }`],
        [String.raw`{ "a":  "\\u0000" }`, String.raw`{ "a":  "\\u0000" }`],
        [
          String.raw`{ "a":  "\ud83d\ude00" }`,
          String.raw`{ "a":  "\ud83d\ude00" }`,
        ],
        [
          String.raw`{ "a":  "\uD83D\uDE00" }`,
          String.raw`{ "a":  "\uD83D\uDE00" }`,
        ],
      ];
      for (const [index, [stored]] of cases.entries()) {
        await seedBrief(client, `h${index}`, index, stored);
      }

      await migrateToHead(client);

      const rows = await client.query<{ body: string }>(
        "select body from brief order by head_index",
      );
      const expected = cases.map(([, cleaned]) => cleaned);
      expect(rows.rows.map((row) => row.body)).toEqual(expected);
      expect(cases.map(([stored]) => cleanJsonText(stored))).toEqual(expected);
      await expect(
        client.query("select body::jsonb from brief"),
      ).resolves.toBeDefined();
    },
    MIGRATE_TWICE_TIMEOUT_MS,
  );

  it(
    "cleans all nine document columns",
    async () => {
      const client = await openPreviousSchema();
      const dirty = String.raw`{"a":"\u0000"}`;
      const overrides: Partial<Record<DocumentKey, string>> = {
        "hunk_span.spans": String.raw`[{"a":"\u0000"}]`,
      };
      for (const key of OBJECT_DOCUMENTS) {
        overrides[key] = dirty;
      }
      await seedEveryDocument(client, overrides);

      await migrateToHead(client);

      for (const key of OBJECT_DOCUMENTS) {
        expect(await readDocument(client, key)).toEqual([
          `{"a":"${REPLACEMENT}"}`,
        ]);
      }
      expect(await readDocument(client, "hunk_span.spans")).toEqual([
        `[{"a":"${REPLACEMENT}"}]`,
      ]);
    },
    MIGRATE_TWICE_TIMEOUT_MS,
  );

  it.each<readonly [DocumentKey, string]>([
    ["chunk_layout.body", "not json"],
    ["comparison_marks.body", "[1]"],
    ["generation_part.body", "not json"],
    ["hunk_span.spans", '{"not":"an array"}'],
  ])(
    "removes a derived %s row off its shape",
    async (key, bad) => {
      const client = await openPreviousSchema();
      await seedEveryDocument(client, { [key]: bad });

      await migrateToHead(client);

      expect(await readDocument(client, key)).toEqual([]);
      expect(await readDocument(client, "brief.body")).toEqual(["{}"]);
    },
    MIGRATE_TWICE_TIMEOUT_MS,
  );

  it.each<DocumentKey>(["brief.repo_config", "generation.repo_config"])(
    "clears a %s off its shape and keeps the row",
    async (key) => {
      const client = await openPreviousSchema();
      await seedEveryDocument(client, { [key]: "not json" });

      await migrateToHead(client);

      expect(await readDocument(client, key)).toEqual([null]);
    },
    MIGRATE_TWICE_TIMEOUT_MS,
  );

  it.each<readonly [DocumentKey, string]>([
    ["brief.body", "brief"],
    ["delta.body", "delta"],
    ["revision_narrative.body", "revision_narrative"],
  ])(
    "stops on a %s that is not JSON and changes nothing",
    async (key, table) => {
      const client = await openPreviousSchema();
      await seedEveryDocument(client, {
        [key]: "not json",
        "chunk_layout.body": "not json",
      });

      await expect(migrateToHead(client)).rejects.toMatchObject({
        cause: {
          message: expect.stringContaining(
            `${table}.body holds 1 rows that are not JSON objects`,
          ),
        },
      });

      expect(await readDocument(client, key)).toEqual(["not json"]);
      expect(await readDocument(client, "chunk_layout.body")).toEqual([
        "not json",
      ]);
    },
    MIGRATE_TWICE_TIMEOUT_MS,
  );
});
