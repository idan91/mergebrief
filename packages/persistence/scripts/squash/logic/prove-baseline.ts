import { execFile } from "node:child_process";
import { cpSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { promisify } from "node:util";
import type { Result } from "types/utils";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { CHECKOUT_MIGRATE_COMMAND } from "../../../src/db/migrate";
import { collectOffenders } from "../../migration-contracts";
import {
  ProofStepNames,
  type LedgerState,
  type ProofInputs,
  type ProofReport,
  type ProofStep,
  type ProofStepName,
  type ScratchPostgresUrl,
} from "../types";
import { dumpSchema, normalizeDump } from "./dump-schema";
import { createDatabase, migrateFolder, queryRows } from "./scratch-database";
import { readJournal, readLastEntry, writeJournal } from "./write-meta";

const execFileAsync = promisify(execFile);
const DIFF_MAX_BUFFER_BYTES = 64 * 1024 * 1024;
const DIFF_EXIT_DIFFERENT = 1;

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type StepVerdict = Result<string, string>;

async function runStep(
  name: ProofStepName,
  step: () => Promise<StepVerdict>,
): Promise<ProofStep> {
  try {
    const verdict = await step();
    if (verdict.ok) {
      return { name, ok: true, detail: verdict.value };
    }
    return { name, ok: false, detail: verdict.error };
  } catch (error) {
    return { name, ok: false, detail: describeError(error) };
  }
}

function isExecFailure(
  error: unknown,
): error is Error & { code: number; stdout: string } {
  if (!(error instanceof Error)) {
    return false;
  }

  const hasExitCode = "code" in error && typeof error.code === "number";
  const hasStdout = "stdout" in error && typeof error.stdout === "string";
  const isExecError = hasExitCode && hasStdout;
  return isExecError;
}

async function diffDumps(
  scratchDir: string,
  chainDump: string,
  baselineDump: string,
): Promise<string> {
  const chainFile = join(scratchDir, "chain.sql");
  const baselineFile = join(scratchDir, "baseline.sql");
  writeFileSync(chainFile, chainDump);
  writeFileSync(baselineFile, baselineDump);
  try {
    await execFileAsync("diff", ["-u", chainFile, baselineFile], {
      maxBuffer: DIFF_MAX_BUFFER_BYTES,
    });
    return "";
  } catch (error) {
    if (!isExecFailure(error)) {
      throw error;
    }
    if (error.code === DIFF_EXIT_DIFFERENT) {
      return error.stdout;
    }
    throw error;
  }
}

async function proveDumpDiff(inputs: ProofInputs): Promise<StepVerdict> {
  const url = await createDatabase(inputs.postgres, "baseline");
  await migrateFolder(url, inputs.squashed.dir);
  const dump = await dumpSchema(inputs.postgres.container, "baseline");
  const baselineDump = normalizeDump(dump);

  if (baselineDump === inputs.chainDump) {
    const lines = baselineDump.split("\n").length - 1;
    return {
      ok: true,
      value: `baseline dump equals chain dump (${lines} lines, ${baselineDump.length} bytes)`,
    };
  }
  const diff = await diffDumps(
    inputs.scratchDir,
    inputs.chainDump,
    baselineDump,
  );
  return {
    ok: false,
    error: `baseline dump differs from the chain dump:\n${diff}`,
  };
}

async function readLedger(url: ScratchPostgresUrl): Promise<LedgerState> {
  const rows = await queryRows(
    url,
    "select count(*)::int as rows, max(created_at)::text as latest from drizzle.__drizzle_migrations",
  );
  const first = rows[0];
  return {
    rows: Number(first?.["rows"]),
    latest: Number(first?.["latest"]),
  };
}

function readBaselineWhen(squashedDir: string): Result<number, string> {
  const journal = readJournal(squashedDir);
  if (!journal.ok) {
    return journal;
  }

  const last = readLastEntry(journal.value);
  if (!last.ok) {
    return last;
  }
  return { ok: true, value: last.value.when };
}

/**
 * The ledger leg's verdict: applying the baseline to a tip database left the
 * ledger alone, and the baseline is no newer than the ledger's latest row.
 */
export function judgeLedgerContinuity(
  before: LedgerState,
  after: LedgerState,
  baselineWhen: number,
): StepVerdict {
  const ledgerMoved =
    before.rows !== after.rows || before.latest !== after.latest;
  if (ledgerMoved) {
    return {
      ok: false,
      error: `the migrator wrote to a tip database's ledger: ${before.rows} rows before, ${after.rows} after`,
    };
  }
  if (baselineWhen > after.latest) {
    return {
      ok: false,
      error: `baseline when ${baselineWhen} is newer than the ledger's latest ${after.latest}; a tip database would re-apply it`,
    };
  }
  return {
    ok: true,
    value: `ledger unchanged at ${after.rows} rows, latest ${after.latest}; baseline when ${baselineWhen}`,
  };
}

async function proveLedgerContinuity(
  inputs: ProofInputs,
): Promise<StepVerdict> {
  const before = await readLedger(inputs.chainUrl);
  await migrateFolder(inputs.chainUrl, inputs.squashed.dir);
  const after = await readLedger(inputs.chainUrl);

  const baseline = readBaselineWhen(inputs.squashed.dir);
  if (!baseline.ok) {
    return baseline;
  }
  return judgeLedgerContinuity(before, after, baseline.value);
}

/** Copies the chain without its newest entry; answers the dropped tag. */
export function rewindChainByOne(
  chainDir: string,
  behindDir: string,
): Result<string, string> {
  cpSync(chainDir, behindDir, { recursive: true });
  const journal = readJournal(behindDir);
  if (!journal.ok) {
    return journal;
  }
  const last = readLastEntry(journal.value);
  if (!last.ok) {
    return last;
  }

  writeJournal(behindDir, {
    ...journal.value,
    entries: journal.value.entries.slice(0, -1),
  });
  rmSync(join(behindDir, `${last.value.tag}.sql`));
  return { ok: true, value: last.value.tag };
}

/**
 * The behind-tip leg's verdict: `applyBaseline` runs the baseline over a
 * database one entry behind the tip, and only a refusal is ok.
 */
export async function judgeBehindTipRefusal(
  dropped: string,
  applyBaseline: () => Promise<void>,
): Promise<StepVerdict> {
  let refusal: string | undefined;
  try {
    await applyBaseline();
  } catch (error) {
    refusal = describeError(error);
  }
  if (refusal === undefined) {
    return {
      ok: false,
      error: `the baseline applied over a database behind the tip (missing ${dropped}); it must refuse`,
    };
  }

  const firstLine = refusal.split("\n")[0];
  return {
    ok: true,
    value: `a database behind the tip (missing ${dropped}) is refused: ${firstLine}. Operator guidance: run \`${CHECKOUT_MIGRATE_COMMAND}\` on the pre-squash commit first, or recreate the database`,
  };
}

async function proveBehindTipRefusal(
  inputs: ProofInputs,
): Promise<StepVerdict> {
  const behindDir = join(inputs.scratchDir, "behind");
  const rewound = rewindChainByOne(inputs.chainDir, behindDir);
  if (!rewound.ok) {
    return rewound;
  }
  const url = await createDatabase(inputs.postgres, "behind");
  await migrateFolder(url, behindDir);

  return judgeBehindTipRefusal(rewound.value, () =>
    migrateFolder(url, inputs.squashed.dir),
  );
}

/** Drizzle's pglite migrator over `folder`, the path the test harness takes. */
export async function applyToPglite(
  folder: string,
  client: PGlite,
): Promise<void> {
  await migrate(drizzle(client), { migrationsFolder: folder });
}

async function provePgliteApply(inputs: ProofInputs): Promise<StepVerdict> {
  const client = new PGlite();
  try {
    await applyToPglite(inputs.squashed.dir, client);
    const tables = await client.query<{ count: number }>(
      "select count(*)::int as count from information_schema.tables where table_schema = 'public'",
    );
    return {
      ok: true,
      value: `PGlite applied the baseline: ${tables.rows[0]?.count ?? 0} tables`,
    };
  } finally {
    await client.close();
  }
}

function buildKitConfig(schemaDir: string, outDir: string): string {
  return [
    "export default {",
    '  dialect: "postgresql",',
    `  schema: ${JSON.stringify(schemaDir)},`,
    `  out: ${JSON.stringify(outDir)},`,
    '  schemaFilter: ["public"],',
    "};",
    "",
  ].join("\n");
}

async function runDrizzleKit(
  packageDir: string,
  args: readonly string[],
): Promise<string> {
  const bin = join(packageDir, "node_modules", ".bin", "drizzle-kit");
  const { stdout, stderr } = await execFileAsync(bin, [...args], {
    cwd: packageDir,
  });
  return `${stdout}${stderr}`.trim();
}

function listFiles(dir: string): string[] {
  return readdirSync(dir).toSorted();
}

async function proveGenerateClean(inputs: ProofInputs): Promise<StepVerdict> {
  const configPath = join(inputs.scratchDir, "drizzle.squash.config.ts");
  // drizzle-kit prefixes `out` with `./`, so both paths are relative to the
  // package dir the kit runs in.
  const schemaDir = relative(
    inputs.packageDir,
    join(inputs.packageDir, "src", "schema"),
  );
  const outDir = relative(inputs.packageDir, inputs.squashed.dir);
  writeFileSync(configPath, buildKitConfig(schemaDir, outDir));

  const before = listFiles(inputs.squashed.dir);
  const generated = await runDrizzleKit(inputs.packageDir, [
    "generate",
    "--config",
    configPath,
  ]);
  const added = listFiles(inputs.squashed.dir).filter(
    (name) => !before.includes(name),
  );
  if (added.length > 0) {
    return {
      ok: false,
      error: `drizzle-kit generate found schema changes over the baseline: ${added.join(", ")}\n${generated}`,
    };
  }

  const checked = await runDrizzleKit(inputs.packageDir, [
    "check",
    "--config",
    configPath,
  ]);
  return {
    ok: true,
    value: `generate wrote nothing (${generated.split("\n").at(-1)}); check: ${checked.split("\n").at(-1)}`,
  };
}

async function proveContractsGate(inputs: ProofInputs): Promise<StepVerdict> {
  const offenders = collectOffenders(inputs.squashed.dir);
  if (offenders.length > 0) {
    const named = offenders.map((offender) => offender.file).join(", ");
    return {
      ok: false,
      error: `the baseline holds destructive statements: ${named}`,
    };
  }
  return { ok: true, value: "no destructive statement in the baseline" };
}

/** Every proof leg, in order, each failing on its own evidence. */
export async function proveBaseline(inputs: ProofInputs): Promise<ProofReport> {
  const steps: ProofStep[] = [
    await runStep(ProofStepNames.DUMP_DIFF, () => proveDumpDiff(inputs)),
    await runStep(ProofStepNames.LEDGER_CONTINUITY, () =>
      proveLedgerContinuity(inputs),
    ),
    await runStep(ProofStepNames.BEHIND_TIP_REFUSAL, () =>
      proveBehindTipRefusal(inputs),
    ),
    await runStep(ProofStepNames.PGLITE_APPLY, () => provePgliteApply(inputs)),
    await runStep(ProofStepNames.GENERATE_CLEAN, () =>
      proveGenerateClean(inputs),
    ),
    await runStep(ProofStepNames.CONTRACTS_GATE, () =>
      proveContractsGate(inputs),
    ),
  ];
  return { ok: steps.every((step) => step.ok), steps };
}
