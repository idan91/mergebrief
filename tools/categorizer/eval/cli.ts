import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod/v4";
import {
  createGenerator,
  Efforts,
  loadGeneratorConfigFile,
  Providers,
  type Effort,
  type Generator,
  type Provider,
  type TokenUsage,
} from "generators";
import type { Result } from "types/utils";
import {
  CallPlanKinds,
  decideCallPlan,
  generateBrief,
  parseChangedRanges,
} from "brief-core";
import { OutlineForms, type OutlineForm } from "brief-core/types";
import { extractConfigFlag } from "../src/cli/config";
import {
  BaselineModes,
  loadBaseline,
  preflightBaselineKeys,
  saveBaseline,
  type BaselineMode,
} from "./baseline";
import { checkBaseBriefsRecorded, recordBaseBrief } from "./base-brief";
import { textLengthNotes } from "./length";
import { loadPrices, priceUsage } from "./cost";
import { loadCases, type EvalCase } from "./loadCase";
import { scoreRuns } from "./properties";
import {
  BillingKinds,
  buildReport,
  renderCostLine,
  type BillingKind,
  type BuiltReport,
  type CaseOutcome,
  type InvocationUsage,
} from "./report";
import { runCase } from "./run";
import {
  countPairGenerations,
  evaluatePairCase,
  loadPairCases,
  selectCases,
  type PairCase,
  type PairRunMode,
} from "./pairs";
import { persistRunBriefs } from "./specimens";
import { withUsageSink } from "./usageSink";

/**
 * `pnpm -C tools/categorizer eval`, the generation regression runner, taking
 * --config, --case, --runs, --rebaseline, --no-baseline, --prices and the
 * multi-call knobs (--force-multi-call, --force-outline, --effort-grouping,
 * --effort-detail). Exit 0 is clean, 1 is at least one regression, 2 is a
 * config or usage error. On-demand only, never wired into CI, every run is
 * live generation spend.
 */

const here = dirname(fileURLToPath(import.meta.url));
const CASES_DIR = join(here, "cases");
/** Revision-pair source, one pair = TWO generations per run. */
const PAIRS_DIR = join(here, "pair-cases");
/** Cases that embed private material; the public snapshot leaves them out. */
const PRIVATE_CASES_DIR = join(here, "private-cases");
const PRIVATE_PAIRS_DIR = join(here, "private-pair-cases");
const OUT_DIR = "out";
/** The generator the committed baselines are keyed to. */
const DEFAULT_CONFIG_PATH = join(
  here,
  "..",
  "mergebrief.eval.claude-code.yaml",
);
/**
 * Must mirror brief-core's DEFAULT_EFFORT: the origin-derived baseline key and
 * the generations have to agree on effort.
 */
const DEFAULT_EFFORT: Effort = "medium";
/** Providers billed by subscription, no meterable marginal cost.
 * Construction is checked against the closed Provider vocabulary; lookup
 * takes the origin's provider string. */
const SUBSCRIPTION_PROVIDERS: ReadonlySet<string> = new Set<Provider>([
  Providers.CLAUDE_CODE,
  Providers.CODEX,
  Providers.CURSOR,
]);
const DEFAULT_RUNS = 5;
const USAGE =
  "usage: pnpm eval [--config <yaml>] [--case <id>] [--runs N] [--rebaseline] [--no-baseline] [--pair-fresh] [--record-base-brief] [--prices <json>] [--force-multi-call] [--force-outline <form>] [--effort-grouping <effort>] [--effort-detail <effort>]";

/**
 * Knobs that steer a single case's generation off the production path:
 * the multi-call route, the outline form the grouping reads and the per-call
 * efforts. A pair case runs unchanged. Never a baseline source.
 */
export interface GenerationKnobs {
  forceMultiCall: boolean;
  forcedOutlineForm?: OutlineForm;
  groupingEffort?: Effort;
  detailEffort?: Effort;
}

const OutlineFormSchema = z.enum(OutlineForms);
const EffortSchema = z.enum(Efforts);

interface MultiCallOnlyKnob {
  readonly flag: `--${string}`;
  readonly read: (knobs: GenerationKnobs) => string | undefined;
}

/** The valued knobs that steer only a multi-call run, by the flag that sets each. */
const MULTI_CALL_ONLY_KNOBS = [
  { flag: "--force-outline", read: (knobs) => knobs.forcedOutlineForm },
  { flag: "--effort-grouping", read: (knobs) => knobs.groupingEffort },
  { flag: "--effort-detail", read: (knobs) => knobs.detailEffort },
] as const satisfies readonly MultiCallOnlyKnob[];

type MultiCallOnlyFlag = (typeof MULTI_CALL_ONLY_KNOBS)[number]["flag"];
type ValuedFlag = "--case" | "--runs" | "--prices" | MultiCallOnlyFlag;
const VALUED_FLAGS: ReadonlySet<string> = new Set<ValuedFlag>([
  "--case",
  "--runs",
  "--prices",
  ...MULTI_CALL_ONLY_KNOBS.map((knob) => knob.flag),
]);

function isValuedFlag(flag: string): flag is ValuedFlag {
  return VALUED_FLAGS.has(flag);
}

export interface EvalArgs {
  configPath: string | null;
  caseId?: string;
  runs: number;
  rebaseline: boolean;
  /**
   * Characterization: run a generator key with NO committed baseline (a
   * cross-model run), skips the key preflight and the comparison; verdicts
   * render as no-baseline. Never combinable with --rebaseline.
   */
  noBaseline: boolean;
  pricesPath: string;
  /**
   * Vacuous-pass probe: pair cases run BOTH generations fresh, no anchor
   * view, no stitch. Anchoring-dependent properties MUST fail under this flag;
   * one that still passes is vacuous. Never combinable with --rebaseline.
   */
  pairFresh: boolean;
  /**
   * Generate one pair case's base Brief on the production path and store it
   * in its pair file, instead of evaluating. Needs `--case`; takes no other
   * mode or knob.
   */
  recordBaseBrief: boolean;
  knobs: GenerationKnobs;
}

function parseRunsValue(value: string): Result<number, string> {
  const runs = Number(value);
  if (!Number.isInteger(runs) || runs < 1) {
    return { ok: false, error: `--runs must be a positive integer` };
  }
  return { ok: true, value: runs };
}

function parseOutlineForm(value: string): Result<OutlineForm, string> {
  const parsed = OutlineFormSchema.safeParse(value);
  if (!parsed.success) {
    const forms = Object.values(OutlineForms).join(", ");
    return { ok: false, error: `--force-outline must be one of ${forms}` };
  }
  return { ok: true, value: parsed.data };
}

function parseEffortValue(
  flag: "--effort-grouping" | "--effort-detail",
  value: string,
): Result<Effort, string> {
  const parsed = EffortSchema.safeParse(value);
  if (!parsed.success) {
    const efforts = Object.values(Efforts).join(", ");
    return { ok: false, error: `${flag} must be one of ${efforts}` };
  }
  return { ok: true, value: parsed.data };
}

function resolveKnobFlag(
  flag: MultiCallOnlyFlag,
  value: string,
  knobs: GenerationKnobs,
): Result<GenerationKnobs, string> {
  if (flag === "--force-outline") {
    const form = parseOutlineForm(value);
    if (!form.ok) {
      return form;
    }
    return { ok: true, value: { ...knobs, forcedOutlineForm: form.value } };
  }

  const effort = parseEffortValue(flag, value);
  if (!effort.ok) {
    return effort;
  }
  if (flag === "--effort-grouping") {
    return { ok: true, value: { ...knobs, groupingEffort: effort.value } };
  }
  return { ok: true, value: { ...knobs, detailEffort: effort.value } };
}

function resolveValuedFlag(
  flag: ValuedFlag,
  value: string,
  knobs: GenerationKnobs,
): Result<Partial<EvalArgs>, string> {
  if (flag === "--case") {
    return { ok: true, value: { caseId: value } };
  }
  if (flag === "--prices") {
    return { ok: true, value: { pricesPath: value } };
  }
  if (flag === "--runs") {
    const runs = parseRunsValue(value);
    if (!runs.ok) {
      return runs;
    }
    return { ok: true, value: { runs: runs.value } };
  }

  const resolved = resolveKnobFlag(flag, value, knobs);
  if (!resolved.ok) {
    return resolved;
  }
  return { ok: true, value: { knobs: resolved.value } };
}

/** The knobs that steer only a multi-call run, named by the flags that set them. */
function listMultiCallOnlyFlags(knobs: GenerationKnobs): MultiCallOnlyFlag[] {
  return MULTI_CALL_ONLY_KNOBS.filter(
    (knob) => knob.read(knobs) !== undefined,
  ).map((knob) => knob.flag);
}

/** Every set knob as its flag reads on the command line, value included. */
export function listKnobFlags(knobs: GenerationKnobs): string[] {
  const flags: string[] = [];
  if (knobs.forceMultiCall) {
    flags.push("--force-multi-call");
  }
  for (const knob of MULTI_CALL_ONLY_KNOBS) {
    const value = knob.read(knobs);
    if (value !== undefined) {
      flags.push(`${knob.flag} ${value}`);
    }
  }
  return flags;
}

function hasGenerationKnob(knobs: GenerationKnobs): boolean {
  return knobs.forceMultiCall || listMultiCallOnlyFlags(knobs).length > 0;
}

/**
 * A stderr note for a case the call plan answers in one call while a knob
 * that steers only a multi-call run is set; undefined when every knob takes
 * effect. Printed before any spend and carried into the report, so a run
 * whose knobs never applied cannot read as an experiment that ran.
 */
export function describeIdleKnobs(
  caseId: string,
  diff: string,
  knobs: GenerationKnobs,
): string | undefined {
  const flags = listMultiCallOnlyFlags(knobs);
  if (knobs.forceMultiCall || flags.length === 0) {
    return undefined;
  }
  const plan = decideCallPlan({ diff });
  if (plan.kind !== CallPlanKinds.SINGLE) {
    return undefined;
  }
  return `note: ${caseId}: ${flags.join(", ")} steer only a multi-call run and the call plan answers this case in one call, so they have no effect here; add --force-multi-call to exercise them`;
}

/**
 * Every stderr note on a knob that will not take effect: pair cases run on
 * the production path, and a one-call single case ignores the multi-call
 * knobs.
 */
function listIdleKnobNotes(
  singleCases: readonly EvalCase[],
  pairCases: readonly PairCase[],
  knobs: GenerationKnobs,
): string[] {
  const notes: string[] = [];
  if (pairCases.length > 0 && hasGenerationKnob(knobs)) {
    notes.push(
      "note: the multi-call knobs steer single cases only; pair cases run on the production path",
    );
  }

  for (const evalCase of singleCases) {
    const idle = describeIdleKnobs(
      evalCase.id,
      evalCase.fixture.pr.diff,
      knobs,
    );
    if (idle !== undefined) {
      notes.push(idle);
    }
  }
  return notes;
}

function readRecordConflict(args: EvalArgs): string | undefined {
  if (!args.recordBaseBrief) {
    return undefined;
  }
  if (args.caseId === undefined) {
    return "--record-base-brief needs --case <pair case id>";
  }
  const otherMode =
    args.rebaseline ||
    args.noBaseline ||
    args.pairFresh ||
    hasGenerationKnob(args.knobs);
  if (otherMode) {
    return "--record-base-brief stores one production-path base Brief; it takes no other mode or knob";
  }
  return undefined;
}

export function parseEvalArgs(argv: string[]): Result<EvalArgs, string> {
  const flagged = extractConfigFlag(argv);
  if (!flagged) {
    return { ok: false, error: "--config needs a path value" };
  }
  const rest = [...flagged.rest];
  const args: EvalArgs = {
    configPath: flagged.configPath,
    runs: DEFAULT_RUNS,
    rebaseline: false,
    noBaseline: false,
    pricesPath: join(here, "prices.json"),
    pairFresh: false,
    recordBaseBrief: false,
    knobs: { forceMultiCall: false },
  };
  while (rest.length > 0) {
    const flag = rest.shift();
    if (flag === "--rebaseline") {
      args.rebaseline = true;
    } else if (flag === "--no-baseline") {
      args.noBaseline = true;
    } else if (flag === "--pair-fresh") {
      args.pairFresh = true;
    } else if (flag === "--record-base-brief") {
      args.recordBaseBrief = true;
    } else if (flag === "--force-multi-call") {
      args.knobs = { ...args.knobs, forceMultiCall: true };
    } else if (flag !== undefined && isValuedFlag(flag)) {
      const value = rest.shift();
      if (value === undefined || value.startsWith("-")) {
        return { ok: false, error: `${flag} needs a value` };
      }
      const valued = resolveValuedFlag(flag, value, args.knobs);
      if (!valued.ok) {
        return valued;
      }
      Object.assign(args, valued.value);
    } else {
      return { ok: false, error: `unknown argument "${flag}"` };
    }
  }
  const recordConflict = readRecordConflict(args);
  if (recordConflict !== undefined) {
    return { ok: false, error: recordConflict };
  }
  if (args.pairFresh && args.rebaseline) {
    return {
      ok: false,
      error: "--pair-fresh is the vacuous-pass probe — never a baseline source",
    };
  }
  if (args.noBaseline && args.rebaseline) {
    return {
      ok: false,
      error:
        "--no-baseline characterizes without a baseline; --rebaseline writes one — pick one",
    };
  }
  if (args.rebaseline && hasGenerationKnob(args.knobs)) {
    return {
      ok: false,
      error:
        "the multi-call knobs steer generation off the production path and are never a baseline source",
    };
  }
  return { ok: true, value: args };
}

export interface CaseSetDirs {
  casesDir: string;
  pairsDir: string;
  privateCasesDir: string;
  privatePairsDir: string;
}

export interface CaseSets {
  singles: EvalCase[];
  pairs: PairCase[];
}

function compareCaseIds(left: { id: string }, right: { id: string }): number {
  return left.id.localeCompare(right.id);
}

async function loadPrivateCases(
  privateCasesDir: string,
): Promise<Result<EvalCase[], string>> {
  if (!existsSync(privateCasesDir)) {
    return { ok: true, value: [] };
  }

  return loadCases(privateCasesDir);
}

/** A missing private dir is an empty source: the public snapshot has none. */
export async function loadCaseSets(
  dirs: CaseSetDirs,
): Promise<Result<CaseSets, string>> {
  const cases = await loadCases(dirs.casesDir);
  if (!cases.ok) {
    return cases;
  }
  const privateCases = await loadPrivateCases(dirs.privateCasesDir);
  if (!privateCases.ok) {
    return privateCases;
  }
  const pairs = await loadPairCases(dirs.pairsDir);
  if (!pairs.ok) {
    return pairs;
  }
  const privatePairs = await loadPairCases(dirs.privatePairsDir);
  if (!privatePairs.ok) {
    return privatePairs;
  }

  const singles = [...cases.value, ...privateCases.value];
  const allPairs = [...pairs.value, ...privatePairs.value];
  return {
    ok: true,
    value: {
      singles: singles.toSorted(compareCaseIds),
      pairs: allPairs.toSorted(compareCaseIds),
    },
  };
}

function loadEnv(): void {
  try {
    process.loadEnvFile(".env");
  } catch {
    // no .env file, the key may still be set in the ambient environment
  }
}

export interface BuiltGenerator {
  readonly generator: Generator;
  readonly effort: Effort;
}

export interface EvalPaths extends CaseSetDirs {
  readonly outDir: string;
}

const EvalExitCodes = {
  PASSED: 0,
  REGRESSED: 1,
  REFUSED: 2,
} as const;

async function buildGenerator(
  configPath: string,
): Promise<Result<BuiltGenerator, string>> {
  const loaded = loadGeneratorConfigFile(configPath);
  if (!loaded.ok) {
    return { ok: false, error: loaded.error.issues.join("; ") };
  }
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
  knobs: GenerationKnobs,
  runs: number,
  key: string,
  baselineMode: BaselineMode,
  progress: (message: string) => void,
  outDir: string,
): Promise<Result<EvaluatedCase, string>> {
  const { fixture } = evalCase;
  let run = 0;
  const generate = async () => {
    run += 1;
    progress(`  ${evalCase.id}: run ${run}/${runs}…`);
    const generated = await generateBrief({
      pr: fixture.pr,
      headIndex: 1,
      commitRange: fixture.commitRange,
      generator,
      effort,
      repoContext: fixture.repoContext,
      gitAttributes: fixture.gitAttributes,
      forceMultiCall: knobs.forceMultiCall,
      forcedOutlineForm: knobs.forcedOutlineForm,
      groupingEffort: knobs.groupingEffort,
      detailEffort: knobs.detailEffort,
      multiCallHooks: {},
    });
    return generated.brief;
  };
  const result = await runCase(generate, runs);
  persistRunBriefs(join(outDir, "eval-runs", evalCase.id), result);
  const scored = scoreRuns(
    evalCase.properties,
    result.briefs,
    parseChangedRanges(fixture.pr.diff),
  );
  const baselinePath = join(evalCase.dir, "baseline.json");
  let baseline: CaseOutcome["baseline"] = null;
  let rebaselined = false;
  if (baselineMode === BaselineModes.COMPARE) {
    const loaded = loadBaseline(baselinePath, key);
    if (!loaded.ok) {
      return loaded;
    }
    baseline = loaded.value;
  } else if (baselineMode === BaselineModes.REBASELINE) {
    if (result.generationFailures > 0) {
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
  }
  // NONE: characterization, scores report with no comparison.
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

/** A generator that adds every call's tokens to `totals`. */
interface MeteredGenerator {
  readonly metered: Generator;
  readonly totals: InvocationUsage;
}

function meterGenerator(generator: Generator): MeteredGenerator {
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
  return { totals, metered: withUsageSink(generator, sink) };
}

/** `--record-base-brief`: one base Brief for the one pair case `--case` named, then the cost line. */
async function runBaseBriefRecording(
  pairCases: readonly PairCase[],
  built: BuiltGenerator,
  key: string,
  billingKind: BillingKind,
): Promise<number> {
  const [pairCase] = pairCases;
  if (pairCase === undefined) {
    console.error("--record-base-brief needs --case to name a pair case");
    return EvalExitCodes.REFUSED;
  }
  console.error(
    `${pairCase.id}: recording its base Brief, one generation (${key})`,
  );

  const { totals, metered } = meterGenerator(built.generator);
  const recorded = await recordBaseBrief(pairCase, metered, built.effort);
  const usage = totals.calls > 0 ? totals : null;
  console.error(
    renderCostLine({
      key,
      billing: { kind: billingKind },
      usage,
      costUsd: null,
    }),
  );
  if (!recorded.ok) {
    console.error(recorded.error);
    return EvalExitCodes.REFUSED;
  }
  console.error(`wrote ${recorded.value}: review and commit it`);
  return EvalExitCodes.PASSED;
}

function resolveBaselineMode(args: EvalArgs): BaselineMode {
  if (args.rebaseline) {
    return BaselineModes.REBASELINE;
  }
  return args.noBaseline ? BaselineModes.NONE : BaselineModes.COMPARE;
}

function announceRun(
  singleCases: readonly EvalCase[],
  pairCases: readonly PairCase[],
  args: EvalArgs,
  pairMode: PairRunMode,
  key: string,
): void {
  // Invocation size IS the spend control. A pair case costs up to four
  // generations per run (base, anchored revision, narrative, delta).
  const pairGenerations = pairCases.reduce(
    (sum, pairCase) => sum + countPairGenerations(pairCase, pairMode),
    0,
  );
  const generationCount = (singleCases.length + pairGenerations) * args.runs;
  const caseCount = singleCases.length + pairCases.length;
  console.error(
    `${caseCount} case${caseCount === 1 ? "" : "s"} (${pairCases.length} pair${pairCases.length === 1 ? "" : "s"}) × ` +
      `${args.runs} runs = ${generationCount} generations (${key})`,
  );
}

interface EvaluatedCases {
  readonly outcomes: readonly CaseOutcome[];
  readonly skippedRebaselines: readonly string[];
}

interface RunWiring {
  readonly args: EvalArgs;
  readonly metered: Generator;
  readonly effort: Effort;
  readonly key: string;
  readonly baselineMode: BaselineMode;
  readonly pairMode: PairRunMode;
  readonly outDir: string;
}

function reportProgress(message: string): void {
  console.error(message);
}

async function evaluateSelectedCases(
  singleCases: readonly EvalCase[],
  pairCases: readonly PairCase[],
  wiring: RunWiring,
): Promise<Result<EvaluatedCases, string>> {
  const { args, metered, effort, key, baselineMode, pairMode, outDir } = wiring;
  const outcomes: CaseOutcome[] = [];
  const skippedRebaselines: string[] = [];

  for (const evalCase of singleCases) {
    // oxlint-disable-next-line no-await-in-loop -- serial by design (run.ts doc)
    const evaluated = await evaluateCase(
      evalCase,
      metered,
      effort,
      args.knobs,
      args.runs,
      key,
      baselineMode,
      reportProgress,
      outDir,
    );
    if (!evaluated.ok) {
      return evaluated;
    }
    outcomes.push(evaluated.value.outcome);
    if (args.rebaseline && !evaluated.value.rebaselined) {
      skippedRebaselines.push(evalCase.id);
    }
  }
  for (const pairCase of pairCases) {
    // oxlint-disable-next-line no-await-in-loop -- serial by design (run.ts doc)
    const evaluated = await evaluatePairCase(
      pairCase,
      metered,
      effort,
      args.runs,
      key,
      baselineMode,
      outDir,
      reportProgress,
      pairMode,
    );
    if (!evaluated.ok) {
      return evaluated;
    }
    outcomes.push(evaluated.value.outcome);
    if (args.rebaseline && !evaluated.value.rebaselined) {
      skippedRebaselines.push(pairCase.id);
    }
  }
  return { ok: true, value: { outcomes, skippedRebaselines } };
}

/** Cost is shown on EVERY spend, and an incomplete rebaseline must not read as done. */
function finishRebaseline(
  costLine: string,
  skippedRebaselines: readonly string[],
): number {
  console.error(costLine);
  if (skippedRebaselines.length > 0) {
    console.error(
      `rebaseline INCOMPLETE — skipped (generation failures): ${skippedRebaselines.join(", ")} — rerun before committing`,
    );
    return EvalExitCodes.REFUSED;
  }
  console.error(
    "rebaseline complete — review and commit the baseline.json diffs",
  );
  return EvalExitCodes.PASSED;
}

function writeEvalReport(report: BuiltReport, outDir: string): number {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    join(outDir, "eval-report.json"),
    `${JSON.stringify(report.json, null, 2)}\n`,
  );
  writeFileSync(join(outDir, "eval-report.md"), `${report.markdown}\n`);
  console.info(report.terminal);
  console.error(`report: ${join(outDir, "eval-report.json")} + .md`);
  return report.regressions > 0
    ? EvalExitCodes.REGRESSED
    : EvalExitCodes.PASSED;
}

/** Everything past the env and the generator's construction; answers the exit code. */
export async function runEval(
  args: EvalArgs,
  built: BuiltGenerator,
  paths: EvalPaths,
): Promise<number> {
  const origin = built.generator.origin(built.effort);
  const key = `${origin.provider}:${origin.model}`;
  const billingKind: BillingKind = SUBSCRIPTION_PROVIDERS.has(origin.provider)
    ? BillingKinds.SUBSCRIPTION
    : BillingKinds.API;

  // Load BOTH case sets unfiltered, then select, `--case` may name a single
  // OR a revision-pair case; an id in neither is the error.
  const caseSets = await loadCaseSets(paths);
  if (!caseSets.ok) {
    console.error(caseSets.error);
    return EvalExitCodes.REFUSED;
  }
  const selected = selectCases(
    caseSets.value.singles,
    caseSets.value.pairs,
    args.caseId,
  );
  if (!selected.ok) {
    console.error(selected.error);
    return EvalExitCodes.REFUSED;
  }
  const { singles: singleCases, pairs: pairCases } = selected.value;
  if (args.recordBaseBrief) {
    return runBaseBriefRecording(pairCases, built, key, billingKind);
  }
  const recorded = checkBaseBriefsRecorded(pairCases);
  if (!recorded.ok) {
    console.error(recorded.error);
    return EvalExitCodes.REFUSED;
  }

  const prices = loadPrices(args.pricesPath);
  if (!prices.ok) {
    console.error(prices.error);
    return EvalExitCodes.REFUSED;
  }

  const baselineMode = resolveBaselineMode(args);

  // Refuse cross-key runs before the first generation spends money.
  // --rebaseline intends to overwrite keys and --no-baseline compares
  // nothing, so only the compare mode preflights.
  if (baselineMode === BaselineModes.COMPARE) {
    const preflight = preflightBaselineKeys(
      [...singleCases, ...pairCases],
      key,
    );
    if (!preflight.ok) {
      console.error(preflight.error);
      return EvalExitCodes.REFUSED;
    }
  }

  const pairMode: PairRunMode = args.pairFresh ? "fresh" : "anchored";
  announceRun(singleCases, pairCases, args, pairMode, key);

  const { totals, metered } = meterGenerator(built.generator);
  const knobNotes = listIdleKnobNotes(singleCases, pairCases, args.knobs);
  for (const note of knobNotes) {
    console.error(note);
  }
  const evaluated = await evaluateSelectedCases(singleCases, pairCases, {
    args,
    metered,
    effort: built.effort,
    key,
    baselineMode,
    pairMode,
    outDir: paths.outDir,
  });
  if (!evaluated.ok) {
    console.error(evaluated.error);
    return EvalExitCodes.REFUSED;
  }

  const usage = totals.calls > 0 ? totals : null;
  const row = prices.value?.[key];
  const costUsd =
    usage !== null && row !== undefined ? priceUsage(key, usage, row) : null;
  const billing = { kind: billingKind };

  if (args.rebaseline) {
    return finishRebaseline(
      renderCostLine({ key, billing, usage, costUsd }),
      evaluated.value.skippedRebaselines,
    );
  }
  const report = buildReport({
    key,
    billing,
    cases: [...evaluated.value.outcomes],
    usage,
    costUsd,
    knobs: listKnobFlags(args.knobs),
    knobNotes,
  });
  return writeEvalReport(report, paths.outDir);
}

async function main(): Promise<void> {
  const parsed = parseEvalArgs(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(parsed.error);
    console.error(USAGE);
    process.exitCode = EvalExitCodes.REFUSED;
    return;
  }
  loadEnv();

  const generator = await buildGenerator(
    parsed.value.configPath ?? DEFAULT_CONFIG_PATH,
  );
  if (!generator.ok) {
    console.error(generator.error);
    process.exitCode = EvalExitCodes.REFUSED;
    return;
  }

  process.exitCode = await runEval(parsed.value, generator.value, {
    casesDir: CASES_DIR,
    pairsDir: PAIRS_DIR,
    privateCasesDir: PRIVATE_CASES_DIR,
    privatePairsDir: PRIVATE_PAIRS_DIR,
    outDir: OUT_DIR,
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  });
}
