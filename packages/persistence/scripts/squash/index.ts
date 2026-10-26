// `pnpm -C packages/persistence squash:migrations [--check | --write]`:
// builds one baseline migration from `pg_dump` of a database migrated through
// the whole chain, proves it against that database, and under `--write`
// replaces `drizzle/` with it. `--check` (the default) writes nothing to the
// repo. The Postgres it needs is its own throwaway container.
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Result } from "types/utils";
import { buildBaselineSql, splitDumpStatements } from "./logic/build-baseline";
import { dumpSchema, normalizeDump } from "./logic/dump-schema";
import { proveBaseline } from "./logic/prove-baseline";
import { createDatabase, migrateFolder } from "./logic/scratch-database";
import { startPostgres } from "./logic/start-postgres";
import {
  applyProofVerdict,
  buildBaselineSnapshot,
  buildJournal,
  compareSnapshots,
  readJournal,
  readLastEntry,
  readSnapshot,
  writeSquashedFolder,
} from "./logic/write-meta";
import {
  SquashModes,
  SquashOutcomes,
  type Journal,
  type JournalEntry,
  type ProofReport,
  type ScratchPostgres,
  type ScratchPostgresUrl,
  type SquashedFolder,
  type SquashMode,
  type SquashOutcome,
} from "./types";

const PACKAGE_DIR = fileURLToPath(new URL("../..", import.meta.url));
const MIGRATIONS_DIR = join(PACKAGE_DIR, "drizzle");
const USAGE_EXIT = 2;
const USAGE = "usage: squash:migrations [--check | --write]";
const SCRATCH_PREFIX = "mergebrief-squash-";
const OUTCOME_LINES: Record<SquashOutcome, string> = {
  [SquashOutcomes.PROOF_FAILED]: "proof FAILED; the repo is untouched",
  [SquashOutcomes.CHECKED]: "proof ok; --check writes nothing",
  [SquashOutcomes.WRITTEN]: `wrote the baseline into ${MIGRATIONS_DIR}`,
};

function parseMode(args: readonly string[]): Result<SquashMode, string> {
  const checkOnly =
    args.length === 0 || (args.length === 1 && args[0] === "--check");
  if (checkOnly) {
    return { ok: true, value: SquashModes.CHECK };
  }
  if (args.length === 1 && args[0] === "--write") {
    return { ok: true, value: SquashModes.WRITE };
  }
  return { ok: false, error: USAGE };
}

function print(line: string): void {
  process.stdout.write(`${line}\n`);
}

function printReport(report: ProofReport): void {
  for (const step of report.steps) {
    const verdict = step.ok ? "ok" : "FAILED";
    print(`${step.name}: ${verdict}. ${step.detail}`);
  }
}

interface ChainBuild {
  readonly chainUrl: ScratchPostgresUrl;
  readonly chainDump: string;
  readonly squashed: SquashedFolder;
}

interface ChainTip {
  readonly journal: Journal;
  readonly lastEntry: JournalEntry;
  readonly snapshot: unknown;
}

function readChainTip(chainDir: string): Result<ChainTip, string> {
  const journal = readJournal(chainDir);
  if (!journal.ok) {
    return journal;
  }
  const lastEntry = readLastEntry(journal.value);
  if (!lastEntry.ok) {
    return lastEntry;
  }
  const snapshot = readSnapshot(chainDir, lastEntry.value);
  if (!snapshot.ok) {
    return snapshot;
  }

  return {
    ok: true,
    value: {
      journal: journal.value,
      lastEntry: lastEntry.value,
      snapshot: snapshot.value,
    },
  };
}

async function buildSquashed(
  postgres: ScratchPostgres,
  chainDir: string,
  scratchDir: string,
): Promise<Result<ChainBuild, string>> {
  const chainUrl = await createDatabase(postgres, "chain");
  await migrateFolder(chainUrl, chainDir);
  const chainDump = normalizeDump(
    await dumpSchema(postgres.container, "chain"),
  );
  const statements = splitDumpStatements(chainDump);
  if (!statements.ok) {
    return statements;
  }

  const tip = readChainTip(chainDir);
  if (!tip.ok) {
    return tip;
  }
  const { journal, lastEntry } = tip.value;
  const snapshot = await buildBaselineSnapshot();
  const comparison = compareSnapshots(tip.value.snapshot, snapshot);
  if (!comparison.equal) {
    return {
      ok: false,
      error: `the schema drifted from the chain's latest snapshot at: ${comparison.drift.join(", ")}`,
    };
  }

  const squashed = writeSquashedFolder(
    join(scratchDir, "squashed"),
    buildBaselineSql(statements.value),
    buildJournal(lastEntry),
    snapshot,
  );
  print(
    `chain: ${journal.entries.length} entries, tip ${lastEntry.tag} (when ${lastEntry.when})`,
  );
  print(
    `baseline: ${statements.value.length} statements in ${squashed.sqlFile}`,
  );
  return { ok: true, value: { chainUrl, chainDump, squashed } };
}

async function runSquash(mode: SquashMode): Promise<number> {
  const scratchTemplate = join(tmpdir(), SCRATCH_PREFIX);
  const scratchDir = mkdtempSync(scratchTemplate);
  const chainDir = join(scratchDir, "chain");
  cpSync(MIGRATIONS_DIR, chainDir, { recursive: true });

  const postgres = await startPostgres();
  print(`postgres: ${postgres.container} on 127.0.0.1:${postgres.port}`);
  try {
    const build = await buildSquashed(postgres, chainDir, scratchDir);
    if (!build.ok) {
      process.stderr.write(`${build.error}\n`);
      return 1;
    }
    const built = build.value;
    const report = await proveBaseline({
      postgres,
      chainDir,
      chainUrl: built.chainUrl,
      chainDump: built.chainDump,
      squashed: built.squashed,
      packageDir: PACKAGE_DIR,
      scratchDir,
    });
    printReport(report);
    const outcome = applyProofVerdict(
      mode,
      report,
      MIGRATIONS_DIR,
      built.squashed,
    );
    print(OUTCOME_LINES[outcome]);
    return outcome === SquashOutcomes.PROOF_FAILED ? 1 : 0;
  } finally {
    await postgres.stop();
    rmSync(scratchDir, { recursive: true, force: true });
  }
}

async function main(): Promise<number> {
  const mode = parseMode(process.argv.slice(2));
  if (!mode.ok) {
    process.stderr.write(`${mode.error}\n`);
    return USAGE_EXIT;
  }
  return runSquash(mode.value);
}

process.exitCode = await main();
