import {
  copyFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { generateDrizzleJson } from "drizzle-kit/api";
import type { Result } from "types/utils";
import { z } from "zod/v4";
import {
  SquashModes,
  SquashOutcomes,
  type BaselineSnapshot,
  type Journal,
  type JournalEntry,
  type ProofReport,
  type SnapshotComparison,
  type SquashedFolder,
  type SquashMode,
  type SquashOutcome,
} from "../types";

export const BASELINE_TAG = "0000_baseline";
const JOURNAL_VERSION = "7";
const DIALECT = "postgresql";
const ZERO_SNAPSHOT_ID = "00000000-0000-0000-0000-000000000000";
const SNAPSHOT_IDENTITY_KEYS = new Set(["id", "prevId"]);
const JSON_INDENT = 2;

const JournalSchema = z.object({
  version: z.string(),
  dialect: z.string(),
  entries: z.array(
    z.object({
      idx: z.number(),
      version: z.string(),
      when: z.number(),
      tag: z.string(),
      breakpoints: z.boolean(),
    }),
  ),
});

function parseJson(text: string): Result<unknown, string> {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, error: reason };
  }
}

export function readJournal(dir: string): Result<Journal, string> {
  const text = readFileSync(join(dir, "meta", "_journal.json"), "utf8");
  const json = parseJson(text);
  if (!json.ok) {
    return json;
  }

  const parsed = JournalSchema.safeParse(json.value);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.message };
  }
  return { ok: true, value: parsed.data };
}

/** The chain's newest entry: its `when` is what the baseline inherits. */
export function readLastEntry(journal: Journal): Result<JournalEntry, string> {
  const last = journal.entries.at(-1);
  if (last === undefined) {
    return { ok: false, error: "the migrations journal holds no entries" };
  }
  return { ok: true, value: last };
}

/** The snapshot drizzle-kit wrote beside the newest chain entry. */
export function readSnapshot(
  dir: string,
  entry: JournalEntry,
): Result<unknown, string> {
  const prefix = entry.tag.slice(0, entry.tag.indexOf("_"));
  const text = readFileSync(
    join(dir, "meta", `${prefix}_snapshot.json`),
    "utf8",
  );
  return parseJson(text);
}

/**
 * One entry whose `when` equals the last chain entry's: drizzle's migrator
 * and the check-only path both apply an entry only when `when` is newer
 * than the ledger's latest, so a database at the chain tip sees nothing
 * pending.
 */
export function buildJournal(lastChainEntry: JournalEntry): Journal {
  return {
    version: JOURNAL_VERSION,
    dialect: DIALECT,
    entries: [
      {
        idx: 0,
        version: JOURNAL_VERSION,
        when: lastChainEntry.when,
        tag: BASELINE_TAG,
        breakpoints: true,
      },
    ],
  };
}

/**
 * The schema as drizzle-kit serializes it, with no predecessor. It reads
 * every export of the schema barrel, as `drizzle-kit generate` does, so a new
 * table needs no second list here.
 */
export async function buildBaselineSnapshot(): Promise<BaselineSnapshot> {
  const schemaExports = await import("../../../src/schema");
  return generateDrizzleJson(schemaExports, ZERO_SNAPSHOT_ID, ["public"]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  const isObject = typeof value === "object" && value !== null;
  const isPlainObject = isObject && !Array.isArray(value);
  return isPlainObject;
}

function collectDrift(
  left: unknown,
  right: unknown,
  path: string,
  drift: string[],
): void {
  const bothRecords = isRecord(left) && isRecord(right);
  if (bothRecords) {
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    for (const key of keys) {
      const childPath = path === "" ? key : `${path}.${key}`;
      collectDrift(left[key], right[key], childPath, drift);
    }
    return;
  }
  const leavesDiffer = JSON.stringify(left) !== JSON.stringify(right);
  if (leavesDiffer) {
    drift.push(path);
  }
}

/** Structural equality of two snapshots, `id` and `prevId` aside. */
export function compareSnapshots(
  left: unknown,
  right: unknown,
): SnapshotComparison {
  const drift: string[] = [];
  const leftBody = isRecord(left) ? stripIdentity(left) : left;
  const rightBody = isRecord(right) ? stripIdentity(right) : right;
  collectDrift(leftBody, rightBody, "", drift);
  return { equal: drift.length === 0, drift };
}

function stripIdentity(
  snapshot: Record<string, unknown>,
): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(snapshot)) {
    if (!SNAPSHOT_IDENTITY_KEYS.has(key)) {
      body[key] = value;
    }
  }
  return body;
}

/** Writes the three files of a squashed `drizzle/` folder into `dir`. */
export function writeSquashedFolder(
  dir: string,
  sql: string,
  journal: Journal,
  snapshot: BaselineSnapshot,
): SquashedFolder {
  const meta = join(dir, "meta");
  mkdirSync(meta, { recursive: true });

  const folder: SquashedFolder = {
    dir,
    sqlFile: join(dir, `${BASELINE_TAG}.sql`),
    journalFile: join(meta, "_journal.json"),
    snapshotFile: join(meta, "0000_snapshot.json"),
  };
  writeFileSync(folder.sqlFile, sql);
  writeJournal(dir, journal);
  writeFileSync(
    folder.snapshotFile,
    JSON.stringify(snapshot, null, JSON_INDENT),
  );
  return folder;
}

export function writeJournal(dir: string, journal: Journal): void {
  writeFileSync(
    join(dir, "meta", "_journal.json"),
    JSON.stringify(journal, null, JSON_INDENT),
  );
}

/**
 * Replaces the checked-in folder's contents with the squashed three files.
 * Every file is removed by name, never the folder, so the folder's identity
 * (and the runtime lookup by `meta/`) is untouched.
 */
export function replaceMigrationsFolder(
  target: string,
  squashed: SquashedFolder,
): void {
  const meta = join(target, "meta");
  for (const name of readdirSync(target)) {
    const path = join(target, name);
    if (statSync(path).isFile()) {
      rmSync(path);
    }
  }
  for (const name of readdirSync(meta)) {
    rmSync(join(meta, name));
  }

  copyFileSync(squashed.sqlFile, join(target, `${BASELINE_TAG}.sql`));
  copyFileSync(squashed.journalFile, join(meta, "_journal.json"));
  copyFileSync(squashed.snapshotFile, join(meta, "0000_snapshot.json"));
}

/** Touches `target` only for a `--write` run whose every proof leg held. */
export function applyProofVerdict(
  mode: SquashMode,
  report: ProofReport,
  target: string,
  squashed: SquashedFolder,
): SquashOutcome {
  if (!report.ok) {
    return SquashOutcomes.PROOF_FAILED;
  }
  if (mode !== SquashModes.WRITE) {
    return SquashOutcomes.CHECKED;
  }
  replaceMigrationsFolder(target, squashed);
  return SquashOutcomes.WRITTEN;
}
