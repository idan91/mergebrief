import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createGenerator,
  defaultGeneratorConfig,
  loadGeneratorConfigFile,
  Providers,
  type Generator,
  type Provider,
  type TokenUsage,
} from "generators";
import type { Result } from "types";
import { categorize } from "../src/categorize";
import { extractConfigFlag } from "../src/cliConfig";
import { loadBaseline, saveBaseline } from "./baseline";
import { loadPrices, priceUsage } from "./cost";
import { loadCases, type EvalCase } from "./loadCase";
import { scoreRuns } from "./properties";
import {
  BillingKinds,
  buildReport,
  renderCostLine,
  type BillingKind,
  type CaseOutcome,
  type InvocationUsage,
} from "./report";
import { runCase } from "./run";
import { withUsageSink } from "./usageSink";

/**
 * `pnpm -C tools/categorizer eval` — the BRIEF-59 regression runner.
 *
 *   eval [--config <mergebrief.config.yaml>] [--case <id>] [--runs N]
 *        [--rebaseline] [--prices <prices.json>]
 *
 * Exit codes: 0 clean · 1 = ≥1 REGRESSION · 2 = config/usage error.
 * On-demand local only — never CI (decision 3). Report artifacts land in
 * out/eval-report.{json,md}; the terminal gets the same lines.
 */

const here = dirname(fileURLToPath(import.meta.url));
const CASES_DIR = join(here, "cases");
const OUT_DIR = "out";
/** Mirrors categorize.ts's EFFORT — provenance key must match generation. */
const EFFORT = "medium" as const;
/** Providers billed by subscription — no meterable marginal cost.
 * Construction is checked against the closed Provider vocabulary; lookup
 * takes the provenance's provider string. */
const SUBSCRIPTION_PROVIDERS: ReadonlySet<string> = new Set<Provider>([
  Providers.CLAUDE_CODE,
  Providers.CODEX,
]);
const DEFAULT_RUNS = 5;

export interface EvalArgs {
  configPath: string | null;
  caseId?: string;
  runs: number;
  rebaseline: boolean;
  pricesPath: string;
}

export function parseEvalArgs(argv: string[]): Result<EvalArgs, string> {
  const flagged = extractConfigFlag(argv);
  if (!flagged) return { ok: false, error: "--config needs a path value" };
  const rest = [...flagged.rest];
  const args: EvalArgs = {
    configPath: flagged.configPath,
    runs: DEFAULT_RUNS,
    rebaseline: false,
    pricesPath: join(here, "prices.json"),
  };
  while (rest.length > 0) {
    const flag = rest.shift();
    if (flag === "--rebaseline") {
      args.rebaseline = true;
    } else if (flag === "--case" || flag === "--runs" || flag === "--prices") {
      const value = rest.shift();
      if (value === undefined || value.startsWith("-")) {
        return { ok: false, error: `${flag} needs a value` };
      }
      if (flag === "--case") args.caseId = value;
      else if (flag === "--prices") args.pricesPath = value;
      else {
        const runs = Number(value);
        if (!Number.isInteger(runs) || runs < 1) {
          return { ok: false, error: `--runs must be a positive integer` };
        }
        args.runs = runs;
      }
    } else {
      return { ok: false, error: `unknown argument "${flag}"` };
    }
  }
  return { ok: true, value: args };
}

function loadEnv(): void {
  try {
    process.loadEnvFile(".env");
  } catch {
    // no .env file — the key may still be set in the ambient environment
  }
}

async function buildGenerator(
  configPath: string | null,
): Promise<Result<Generator, string>> {
  const loaded =
    configPath !== null
      ? loadGeneratorConfigFile(configPath)
      : { ok: true as const, value: { generator: defaultGeneratorConfig } };
  if (!loaded.ok) return { ok: false, error: loaded.error.issues.join("; ") };
  const constructed = await createGenerator(loaded.value.generator, {
    env: process.env,
    failureDir: OUT_DIR,
  });
  if (!constructed.ok) {
    return { ok: false, error: constructed.error.issues.join("; ") };
  }
  return { ok: true, value: constructed.value };
}

interface EvaluatedCase {
  outcome: CaseOutcome;
  /** Rebaseline mode only: true when this case's baseline was written. */
  rebaselined: boolean;
}

async function evaluateCase(
  evalCase: EvalCase,
  generator: Generator,
  runs: number,
  key: string,
  rebaseline: boolean,
  progress: (message: string) => void,
): Promise<Result<EvaluatedCase, string>> {
  const { fixture } = evalCase;
  let run = 0;
  const generate = async () => {
    run += 1;
    progress(`  ${evalCase.id}: run ${run}/${runs}…`);
    return categorize(
      fixture.pr,
      1,
      fixture.commitRange,
      generator,
      () => {},
      fixture.repoContext,
    );
  };
  const result = await runCase(generate, runs);
  const scored = scoreRuns(evalCase.properties, result.briefs);
  const baselinePath = join(evalCase.dir, "baseline.json");
  let baseline: CaseOutcome["baseline"] = null;
  let rebaselined = false;
  if (!rebaseline) {
    const loaded = loadBaseline(baselinePath, key);
    if (!loaded.ok) return loaded;
    baseline = loaded.value;
  } else if (result.generationFailures > 0) {
    progress(
      `  ${evalCase.id}: NOT rebaselining — ${result.generationFailures} generation failures`,
    );
  } else {
    saveBaseline(baselinePath, {
      key,
      runs: result.briefs.length,
      properties: Object.fromEntries(
        [...scored.scores.entries()].map(([id, score]) => [id, score.passes]),
      ),
    });
    rebaselined = true;
    progress(`  ${evalCase.id}: baseline written (${key})`);
  }
  return {
    ok: true,
    value: {
      outcome: {
        caseId: evalCase.id,
        runsRequested: runs,
        runsScored: result.briefs.length,
        generationFailures: result.generationFailures,
        properties: evalCase.properties,
        scores: scored.scores,
        baseline,
        notes: [...result.failureMessages, ...scored.notes],
      },
      rebaselined,
    },
  };
}

async function main(): Promise<void> {
  const parsed = parseEvalArgs(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(parsed.error);
    console.error(
      "usage: pnpm eval [--config <yaml>] [--case <id>] [--runs N] [--rebaseline] [--prices <json>]",
    );
    process.exit(2);
  }
  const args = parsed.value;
  loadEnv();

  const generator = await buildGenerator(args.configPath);
  if (!generator.ok) {
    console.error(generator.error);
    process.exit(2);
  }
  const provenance = generator.value.provenance(EFFORT);
  const key = `${provenance.provider}:${provenance.model}`;
  const billingKind: BillingKind = SUBSCRIPTION_PROVIDERS.has(provenance.provider)
    ? BillingKinds.SUBSCRIPTION
    : BillingKinds.API;

  const cases = await loadCases(CASES_DIR, args.caseId);
  if (!cases.ok) {
    console.error(cases.error);
    process.exit(2);
  }
  if (cases.value.length === 0) {
    console.error(`no cases under ${CASES_DIR} — corpus lands in BRIEF-59 PR 3`);
    process.exit(2);
  }

  const prices = loadPrices(args.pricesPath);
  if (!prices.ok) {
    console.error(prices.error);
    process.exit(2);
  }

  // Pre-flight: invocation size IS the spend control (decision 7).
  console.error(
    `${cases.value.length} case${cases.value.length === 1 ? "" : "s"} × ` +
      `${args.runs} runs = ${cases.value.length * args.runs} generations (${key})`,
  );

  const totals: InvocationUsage = {
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
  };
  const sink = (usage: TokenUsage): void => {
    totals.calls += 1;
    totals.inputTokens += usage.inputTokens;
    totals.outputTokens += usage.outputTokens;
    totals.cacheReadTokens += usage.cacheReadTokens;
  };
  const metered = withUsageSink(generator.value, sink);

  const outcomes: CaseOutcome[] = [];
  const skippedRebaselines: string[] = [];
  for (const evalCase of cases.value) {
    // eslint-disable-next-line no-await-in-loop -- serial by design (run.ts doc)
    const evaluated = await evaluateCase(
      evalCase,
      metered,
      args.runs,
      key,
      args.rebaseline,
      (message) => console.error(message),
    );
    if (!evaluated.ok) {
      console.error(evaluated.error);
      process.exit(2);
    }
    outcomes.push(evaluated.value.outcome);
    if (args.rebaseline && !evaluated.value.rebaselined) {
      skippedRebaselines.push(evalCase.id);
    }
  }

  const usage = totals.calls > 0 ? totals : null;
  const row = prices.value?.[key];
  const costUsd =
    usage !== null && row !== undefined ? priceUsage(key, usage, row) : null;

  if (args.rebaseline) {
    // Cost is shown on EVERY spend (decision 7) — the first real spend is
    // a rebaseline run. An incomplete rebaseline must not read as done.
    console.error(renderCostLine({ key, billing: { kind: billingKind }, usage, costUsd }));
    if (skippedRebaselines.length > 0) {
      console.error(
        `rebaseline INCOMPLETE — skipped (generation failures): ${skippedRebaselines.join(", ")} — rerun before committing`,
      );
      process.exit(2);
    }
    console.error("rebaseline complete — review and commit the baseline.json diffs");
    return;
  }
  const report = buildReport({
    key,
    billing: { kind: billingKind },
    cases: outcomes,
    usage,
    costUsd,
  });

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(
    join(OUT_DIR, "eval-report.json"),
    `${JSON.stringify(report.json, null, 2)}\n`,
  );
  writeFileSync(join(OUT_DIR, "eval-report.md"), `${report.markdown}\n`);
  console.info(report.terminal);
  console.error(`report: ${join(OUT_DIR, "eval-report.json")} + .md`);
  process.exit(report.regressions > 0 ? 1 : 0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  });
}
