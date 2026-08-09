import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createGenerator,
  defaultGeneratorConfig,
  loadGeneratorConfigFile,
  Providers,
  type Effort,
  type Generator,
  type Provider,
  type TokenUsage,
} from "generators";
import type { Result } from "types";
import { categorize } from "brief-core";
import { extractConfigFlag } from "brief-core/cli-config";
import { loadBaseline, preflightBaselineKeys, saveBaseline } from "./baseline";
import { textLengthNotes } from "./length";
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
import { evaluatePairCase, loadPairCases, selectCases } from "./pairs";
import { persistRunBriefs } from "./specimens";
import { withUsageSink } from "./usageSink";

/**
 * `pnpm -C tools/categorizer eval` — the generation regression runner.
 *
 *   eval [--config <mergebrief.config.yaml>] [--case <id>] [--runs N]
 *        [--rebaseline] [--prices <prices.json>]
 *
 * Exit codes: 0 clean · 1 = ≥1 REGRESSION · 2 = config/usage error.
 * On-demand only, never wired into CI — every run is live API spend. Report
 * artifacts land in out/eval-report.{json,md}.
 */

const here = dirname(fileURLToPath(import.meta.url));
const CASES_DIR = join(here, "cases");
/** Revision-pair source — one pair = TWO generations per run. */
const PAIRS_DIR = join(here, "pair-cases");
const OUT_DIR = "out";
/**
 * Must mirror brief-core's DEFAULT_EFFORT: the origin-derived baseline key and
 * the generations have to agree on effort.
 */
const DEFAULT_EFFORT: Effort = "medium";
/** Providers billed by subscription — no meterable marginal cost.
 * Construction is checked against the closed Provider vocabulary; lookup
 * takes the origin's provider string. */
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
  /**
   * Vacuous-pass probe: pair cases run BOTH generations fresh — no anchor
   * view, no stitch. Anchoring-dependent properties MUST fail under this flag;
   * one that still passes is vacuous. Never combinable with --rebaseline.
   */
  pairFresh: boolean;
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
    pairFresh: false,
  };
  while (rest.length > 0) {
    const flag = rest.shift();
    if (flag === "--rebaseline") {
      args.rebaseline = true;
    } else if (flag === "--pair-fresh") {
      args.pairFresh = true;
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
  if (args.pairFresh && args.rebaseline) {
    return {
      ok: false,
      error: "--pair-fresh is the vacuous-pass probe — never a baseline source",
    };
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
): Promise<Result<{ generator: Generator; effort: Effort }, string>> {
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
  return {
    ok: true,
    value: {
      generator: constructed.value,
      effort: loaded.value.generator.effort ?? DEFAULT_EFFORT,
    },
  };
}

interface EvaluatedCase {
  outcome: CaseOutcome;
  /** Rebaseline mode only: true when this case's baseline was written. */
  rebaselined: boolean;
}

async function evaluateCase(
  evalCase: EvalCase,
  generator: Generator,
  effort: Effort,
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
      effort,
    );
  };
  const result = await runCase(generate, runs);
  persistRunBriefs(join(OUT_DIR, "eval-runs", evalCase.id), result);
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
        notes: [
          ...result.failureMessages,
          ...scored.notes,
          ...textLengthNotes(result.briefs),
        ],
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
      "usage: pnpm eval [--config <yaml>] [--case <id>] [--runs N] [--rebaseline] [--pair-fresh] [--prices <json>]",
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
  const origin = generator.value.generator.origin(generator.value.effort);
  const key = `${origin.provider}:${origin.model}`;
  const billingKind: BillingKind = SUBSCRIPTION_PROVIDERS.has(origin.provider)
    ? BillingKinds.SUBSCRIPTION
    : BillingKinds.API;

  // Load BOTH case sets unfiltered, then select — `--case` may name a single
  // OR a revision-pair case; an id in neither is the error.
  const allCases = await loadCases(CASES_DIR);
  if (!allCases.ok) {
    console.error(allCases.error);
    process.exit(2);
  }
  const allPairs = await loadPairCases(PAIRS_DIR);
  if (!allPairs.ok) {
    console.error(allPairs.error);
    process.exit(2);
  }
  const selected = selectCases(allCases.value, allPairs.value, args.caseId);
  if (!selected.ok) {
    console.error(selected.error);
    process.exit(2);
  }
  const { singles: singleCases, pairs: pairCases } = selected.value;

  const prices = loadPrices(args.pricesPath);
  if (!prices.ok) {
    console.error(prices.error);
    process.exit(2);
  }

  // Refuse cross-key runs before the first generation spends money.
  // --rebaseline intends to overwrite keys, so it skips the preflight.
  if (!args.rebaseline) {
    const preflight = preflightBaselineKeys(
      [...singleCases, ...pairCases],
      key,
    );
    if (!preflight.ok) {
      console.error(preflight.error);
      process.exit(2);
    }
  }

  // Invocation size IS the spend control. A pair case costs TWO generations
  // per run (base + anchored revision).
  const generationCount =
    singleCases.length * args.runs + pairCases.length * args.runs * 2;
  const caseCount = singleCases.length + pairCases.length;
  console.error(
    `${caseCount} case${caseCount === 1 ? "" : "s"} (${pairCases.length} pair${pairCases.length === 1 ? "" : "s"}) × ` +
      `${args.runs} runs = ${generationCount} generations (${key})`,
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
  const metered = withUsageSink(generator.value.generator, sink);

  const outcomes: CaseOutcome[] = [];
  const skippedRebaselines: string[] = [];
  for (const evalCase of singleCases) {
    // eslint-disable-next-line no-await-in-loop -- serial by design (run.ts doc)
    const evaluated = await evaluateCase(
      evalCase,
      metered,
      generator.value.effort,
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
  for (const pairCase of pairCases) {
    // eslint-disable-next-line no-await-in-loop -- serial by design (run.ts doc)
    const evaluated = await evaluatePairCase(
      pairCase,
      metered,
      generator.value.effort,
      args.runs,
      key,
      args.rebaseline,
      OUT_DIR,
      (message) => console.error(message),
      args.pairFresh ? "fresh" : "anchored",
    );
    if (!evaluated.ok) {
      console.error(evaluated.error);
      process.exit(2);
    }
    outcomes.push(evaluated.value.outcome);
    if (args.rebaseline && !evaluated.value.rebaselined) {
      skippedRebaselines.push(pairCase.id);
    }
  }

  const usage = totals.calls > 0 ? totals : null;
  const row = prices.value?.[key];
  const costUsd =
    usage !== null && row !== undefined ? priceUsage(key, usage, row) : null;

  if (args.rebaseline) {
    // Cost is shown on EVERY spend, and an incomplete rebaseline must not
    // read as done.
    console.error(
      renderCostLine({ key, billing: { kind: billingKind }, usage, costUsd }),
    );
    if (skippedRebaselines.length > 0) {
      console.error(
        `rebaseline INCOMPLETE — skipped (generation failures): ${skippedRebaselines.join(", ")} — rerun before committing`,
      );
      process.exit(2);
    }
    console.error(
      "rebaseline complete — review and commit the baseline.json diffs",
    );
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
