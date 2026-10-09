import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  readBriefSessionFacts,
  readStoredBrief,
  readStoredDeltaBrief,
  readStoredRevisionNarrative,
  STORED_BODY_VERSION,
} from "brief-core/artifact";
import { fillMissingIntentFields } from "./intent-fields";
import {
  BRIEF_FILE_SUFFIX,
  DeletableTables,
  FILE_INDENT,
  LEGACY_ISSUE_CODES,
  PAGE_SIZE,
} from "./consts";
import {
  BriefReadKinds,
  type BriefCounts,
  type BriefRead,
  type DeletionCounts,
  type NormalizeOptions,
  type NormalizeSummary,
  type SqlRunner,
  type StoredBodyReader,
  type StoredRow,
} from "./types";

export type {
  BriefCounts,
  NormalizeOptions,
  NormalizeSummary,
  SqlRunner,
} from "./types";

/** A legacy body comes back as the reader's current-shape Brief. */
function classifyBrief(body: string): BriefRead {
  const filled = fillMissingIntentFields(body);
  const read = readStoredBrief(filled ?? body);
  if (!read.ok) {
    return { kind: BriefReadKinds.UNREADABLE };
  }
  const translated = read.value.issues.some((issue) =>
    LEGACY_ISSUE_CODES.has(issue.code),
  );
  const isLegacy = filled !== undefined || translated;
  if (!isLegacy) {
    return { kind: BriefReadKinds.CURRENT };
  }
  return { kind: BriefReadKinds.LEGACY, brief: read.value.brief };
}

/** `table` is one of the fixed names in `consts.ts`, never input. */
async function* walkRows(
  runner: SqlRunner,
  table: string,
): AsyncGenerator<StoredRow> {
  let afterId = "0";
  for (;;) {
    const page = await runner.query(
      `select id::text as id, body from ${table} where id > $1::bigint order by id limit $2`,
      [afterId, PAGE_SIZE],
    );
    const rows = page.map((row) => ({
      id: String(row["id"]),
      body: String(row["body"]),
    }));
    yield* rows;

    const last = rows.at(-1);
    const isLastPage = last === undefined || rows.length < PAGE_SIZE;
    if (isLastPage) {
      return;
    }
    afterId = last.id;
  }
}

/** Matches the body it read, so a row the worker rewrote since is left alone. */
async function replaceBriefBody(
  runner: SqlRunner,
  row: StoredRow,
  body: string,
): Promise<void> {
  const facts = readBriefSessionFacts(body);
  const counts = facts.ok
    ? [
        facts.value.markableChunkCount,
        facts.value.groupIds.length,
        facts.value.flags.length,
      ]
    : [null, null, null];
  await runner.query(
    `update brief set body = $2, byte_size = $3, body_version = $4,
       session_chunk_count = $5, session_group_count = $6, session_flag_count = $7
     where id = $1::bigint and body = $8`,
    [
      row.id,
      body,
      Buffer.byteLength(body, "utf8"),
      STORED_BODY_VERSION,
      ...counts,
      row.body,
    ],
  );
}

async function normalizeBriefRows(
  runner: SqlRunner,
  options: NormalizeOptions,
): Promise<BriefCounts> {
  const counts: BriefCounts = { scanned: 0, rewritten: 0, unreadable: 0 };

  for await (const row of walkRows(runner, "brief")) {
    counts.scanned += 1;
    const read = classifyBrief(row.body);
    if (read.kind !== BriefReadKinds.LEGACY) {
      const isUnreadable = read.kind === BriefReadKinds.UNREADABLE;
      counts.unreadable += isUnreadable ? 1 : 0;
      continue;
    }
    counts.rewritten += 1;
    if (options.apply) {
      await replaceBriefBody(runner, row, JSON.stringify(read.brief));
    }
  }

  return counts;
}

async function deleteRefusedRows(
  runner: SqlRunner,
  table: string,
  read: StoredBodyReader,
  options: NormalizeOptions,
): Promise<DeletionCounts> {
  const counts: DeletionCounts = { scanned: 0, deleted: 0 };

  for await (const row of walkRows(runner, table)) {
    counts.scanned += 1;
    if (read(row.body).ok) {
      continue;
    }
    counts.deleted += 1;
    if (options.apply) {
      await runner.query(
        `delete from ${table} where id = $1::bigint and body = $2`,
        [row.id, row.body],
      );
    }
  }

  return counts;
}

/**
 * Every tenant's rows: a legacy Brief is rewritten in the current shape, and a
 * Delta Brief or narrative the current reader refuses is deleted. A second run
 * changes nothing.
 */
export async function normalizeStoredShapes(
  runner: SqlRunner,
  options: NormalizeOptions,
): Promise<NormalizeSummary> {
  const briefs = await normalizeBriefRows(runner, options);
  const deltas = await deleteRefusedRows(
    runner,
    DeletableTables.DELTA,
    readStoredDeltaBrief,
    options,
  );
  const narratives = await deleteRefusedRows(
    runner,
    DeletableTables.REVISION_NARRATIVE,
    readStoredRevisionNarrative,
    options,
  );
  return { briefs, deltas, narratives };
}

/** The local out dir's `.brief.json` files, by the same rule as the rows. */
export async function normalizeBriefFiles(
  dir: string,
  options: NormalizeOptions,
): Promise<BriefCounts> {
  const counts: BriefCounts = { scanned: 0, rewritten: 0, unreadable: 0 };
  const names = await readdir(dir);
  const briefNames = names.filter((name) => name.endsWith(BRIEF_FILE_SUFFIX));

  for (const name of briefNames) {
    counts.scanned += 1;
    const path = join(dir, name);
    const read = classifyBrief(await readFile(path, "utf8"));
    if (read.kind !== BriefReadKinds.LEGACY) {
      const isUnreadable = read.kind === BriefReadKinds.UNREADABLE;
      counts.unreadable += isUnreadable ? 1 : 0;
      continue;
    }
    counts.rewritten += 1;
    if (options.apply) {
      const pretty = JSON.stringify(read.brief, null, FILE_INDENT);
      await writeFile(path, `${pretty}\n`);
    }
  }

  return counts;
}
