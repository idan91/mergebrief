import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod/v4";
import { AnchorStates, type Result } from "types";
import {
  generateBrief,
  planAnchoredGeneration,
  splitDiffByFile,
  type AnchorPlan,
  type GenerateBriefOptions,
} from "brief-core";
import {
  BetweenHeadsKinds,
  buildFastForwardSpan,
  buildPrSpan,
  isSpanUnchanged,
  type PrSpan,
} from "brief-core/pr-span";
import {
  BriefSchema,
  ReviewCommentSchema,
  type Brief,
  type ReviewComment,
} from "brief-core/types";
import type { Effort, Generator } from "generators";
import { textLengthNotes } from "./length";
import {
  BaselineModes,
  loadBaseline,
  saveBaseline,
  type BaselineMode,
  type CaseBaseline,
} from "./baseline";
import {
  FixtureSchema,
  readCaseJson,
  toRepoContext,
  toFetchedPr,
  type EvalFixture,
} from "./loadCase";
import type { CaseOutcome } from "./report";
import {
  BASE_BRIEF_INDEX,
  generateDeltaRun,
  generateNarrativeRun,
  readSpanSkip,
  REVISED_BRIEF_INDEX,
  type DeltaEvalProperty,
  type DeltaRun,
  type NarrativeEvalProperty,
  type NarrativeRun,
  type RevisionSpanInputs,
} from "./revision-runs";
import { persistRunBriefs } from "./specimens";

/**
 * Pair properties run the production `generateBrief` entry, fresh then anchored.
 * Unbaselined cases withhold verdicts. Establish baselines only through explicit review
 * after proving that deliberately broken pairs fail their predicates.
 */

const PairIncrementSchema = z.object({
  /** The PR's own change between the heads, hunks touching no PR line dropped; "" when the push left the PR diff unchanged. */
  filteredSpan: z.string(),
  /** Every between-heads hunk of the changed files; on a fast-forward, the three-dot diff. */
  unfilteredSpan: z.string(),
});

const PairFixtureSchema = z.object({
  base: FixtureSchema,
  revised: FixtureSchema,
  increment: PairIncrementSchema,
  /** The base head's Brief, read instead of generating one. */
  baseBrief: BriefSchema.optional(),
  /** Review comments that existed at the revised head; the delta reads them only on the case's opt-in. */
  reviewComments: z.array(ReviewCommentSchema).optional(),
});

/** A pair.json as written to disk, before parsing. */
export type PairFixtureFile = z.input<typeof PairFixtureSchema>;

export const PAIR_FILE = "pair.json";

export interface PairFixture {
  base: EvalFixture;
  revised: EvalFixture;
  filteredSpan: string;
  unfilteredSpan: string;
  baseBrief?: Brief;
  reviewComments?: ReviewComment[];
}

/** One scored revision pair: both persisted-shape briefs plus the plan. */
export interface RevisionPair {
  base: Brief;
  revised: Brief;
  plan: AnchorPlan;
}

/**
 * One mechanical predicate over a revision pair. Same register as
 * `EvalProperty`: anchor on run-stable facts, group survival, id carry,
 * attribute presence, coverage, never chunk boundaries or free-form text.
 */
export interface PairEvalProperty {
  id: string;
  description: string;
  check(pair: RevisionPair): boolean;
}

export interface PairCase {
  id: string;
  dir: string;
  fixture: PairFixture;
  properties: PairEvalProperty[];
  /** Empty when the case does not opt into the narrative. */
  narrativeProperties: NarrativeEvalProperty[];
  /** Empty when the case does not opt into the delta. */
  deltaProperties: DeltaEvalProperty[];
  /** The delta reads `reviewComments`, as the dev CLI does; the worker sends none, so off by default. */
  deltaReadsReviewComments: boolean;
}

/** The shape every property list shares; the check's argument differs per list. */
interface ScoredProperty<Run> {
  id: string;
  description: string;
  check(run: Run): boolean;
}

/** The run argument cannot be checked at runtime; a case's expected.ts owns that. */
function isProperty<Run>(value: unknown): value is ScoredProperty<Run> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "id") === "string" &&
    typeof Reflect.get(value, "description") === "string" &&
    typeof Reflect.get(value, "check") === "function"
  );
}

/**
 * Load every `pair-cases/<id>/` (pair.json + expected.ts exporting
 * `pairProperties`). A missing directory is an empty source, not an error,
 * the pair source lands incrementally.
 */
export async function loadPairCases(
  pairsDir: string,
  onlyCase?: string,
): Promise<Result<PairCase[], string>> {
  if (!existsSync(pairsDir)) {
    return { ok: true, value: [] };
  }
  const ids = readdirSync(pairsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted((a, b) => a.localeCompare(b));
  const selected =
    onlyCase === undefined ? ids : ids.filter((id) => id === onlyCase);
  if (onlyCase !== undefined && selected.length === 0) {
    return {
      ok: false,
      error: `unknown pair case "${onlyCase}" — available: ${ids.join(", ") || "(none)"}`,
    };
  }
  const cases: PairCase[] = [];
  for (const id of selected) {
    // oxlint-disable-next-line no-await-in-loop -- sequential: first bad case aborts the load
    const loaded = await loadOnePair(id, join(pairsDir, id));
    if (!loaded.ok) {
      return loaded;
    }
    cases.push(loaded.value);
  }
  return { ok: true, value: cases };
}

async function loadOnePair(
  id: string,
  dir: string,
): Promise<Result<PairCase, string>> {
  const caseLabel = `pair case "${id}"`;
  const raw = readCaseJson(caseLabel, dir, PAIR_FILE);
  if (!raw.ok) {
    return raw;
  }
  const parsed = PairFixtureSchema.safeParse(raw.value);
  if (!parsed.success) {
    return {
      ok: false,
      error: `${caseLabel}: invalid pair.json — ${z.prettifyError(parsed.error)}`,
    };
  }
  const expectedPath = join(dir, "expected.ts");
  if (!existsSync(expectedPath)) {
    return { ok: false, error: `${caseLabel}: missing expected.ts` };
  }
  const module: unknown = await import(pathToFileURL(expectedPath).href);
  const properties = readCaseProperties(caseLabel, module);
  if (!properties.ok) {
    return properties;
  }

  const fixture = shapePairFixture(parsed.data);
  const fixtureCheck = checkFixtureFits(caseLabel, fixture);
  if (!fixtureCheck.ok) {
    return fixtureCheck;
  }
  const commentOptIn = readCommentOptIn(
    caseLabel,
    module,
    fixture,
    properties.value,
  );
  if (!commentOptIn.ok) {
    return commentOptIn;
  }
  const spanSkip = readOptInSpanSkip(
    fixture,
    properties.value,
    commentOptIn.value,
  );
  if (spanSkip !== undefined) {
    return { ok: false, error: `${caseLabel}: ${spanSkip}` };
  }

  return {
    ok: true,
    value: {
      id,
      dir,
      fixture,
      ...properties.value,
      deltaReadsReviewComments: commentOptIn.value,
    },
  };
}

type CaseProperties = Pick<
  PairCase,
  "properties" | "narrativeProperties" | "deltaProperties"
>;

/**
 * The case's three property lists. `pairProperties` is required; the other
 * two are each an opt-in. Ids are unique across all three, refused at load
 * time before any generation spends money.
 */
function readCaseProperties(
  caseLabel: string,
  module: unknown,
): Result<CaseProperties, string> {
  const lists = {
    properties: readPropertyExport<RevisionPair>(module, "pairProperties"),
    narrativeProperties: readPropertyExport<NarrativeRun>(
      module,
      "narrativeProperties",
    ),
    deltaProperties: readPropertyExport<DeltaRun>(module, "deltaProperties"),
  };
  if (lists.properties === undefined || lists.properties === "invalid") {
    return {
      ok: false,
      error: `${caseLabel}: expected.ts must export \`pairProperties: PairEvalProperty[]\``,
    };
  }
  if (lists.narrativeProperties === "invalid") {
    return {
      ok: false,
      error: `${caseLabel}: expected.ts \`narrativeProperties\` is not a NarrativeEvalProperty[]`,
    };
  }
  if (lists.deltaProperties === "invalid") {
    return {
      ok: false,
      error: `${caseLabel}: expected.ts \`deltaProperties\` is not a DeltaEvalProperty[]`,
    };
  }

  const value: CaseProperties = {
    properties: lists.properties,
    narrativeProperties: lists.narrativeProperties ?? [],
    deltaProperties: lists.deltaProperties ?? [],
  };
  const all = [
    ...value.properties,
    ...value.narrativeProperties,
    ...value.deltaProperties,
  ];
  if (all.length === 0) {
    return {
      ok: false,
      error: `${caseLabel}: expected.ts exports no properties`,
    };
  }
  const duplicate = findDuplicateId(all);
  if (duplicate !== undefined) {
    return {
      ok: false,
      error: `${caseLabel}: duplicate property id "${duplicate}"`,
    };
  }
  return { ok: true, value };
}

/** An absent export is `undefined`; one that is not a property list is "invalid". */
function readPropertyExport<Run>(
  module: unknown,
  name: string,
): ScoredProperty<Run>[] | "invalid" | undefined {
  const exported =
    typeof module === "object" && module !== null
      ? Reflect.get(module, name)
      : undefined;
  if (exported === undefined) {
    return undefined;
  }
  if (!Array.isArray(exported) || !exported.every(isProperty<Run>)) {
    return "invalid";
  }
  return exported;
}

function findDuplicateId(
  properties: readonly { id: string }[],
): string | undefined {
  const seen = new Set<string>();
  for (const property of properties) {
    if (seen.has(property.id)) {
      return property.id;
    }
    seen.add(property.id);
  }
  return undefined;
}

function checkFixtureFits(
  caseLabel: string,
  fixture: PairFixture,
): Result<void, string> {
  const storedHead = fixture.baseBrief?.commitRange.head;
  const baseHead = fixture.base.commitRange.head;
  if (storedHead !== undefined && storedHead !== baseHead) {
    return {
      ok: false,
      error: `${caseLabel}: baseBrief is for head ${storedHead}, the base head is ${baseHead}`,
    };
  }
  return { ok: true, value: undefined };
}

/** `deltaReadsReviewComments`: absent is false; true needs delta properties and recorded comments. */
function readCommentOptIn(
  caseLabel: string,
  module: unknown,
  fixture: PairFixture,
  properties: CaseProperties,
): Result<boolean, string> {
  const exported =
    typeof module === "object" && module !== null
      ? Reflect.get(module, "deltaReadsReviewComments")
      : undefined;
  if (exported === undefined || exported === false) {
    return { ok: true, value: false };
  }
  if (exported !== true) {
    return {
      ok: false,
      error: `${caseLabel}: expected.ts \`deltaReadsReviewComments\` must be a boolean`,
    };
  }

  if (properties.deltaProperties.length === 0) {
    return {
      ok: false,
      error: `${caseLabel}: deltaReadsReviewComments without deltaProperties scores nothing`,
    };
  }
  if (fixture.reviewComments === undefined) {
    return {
      ok: false,
      error: `${caseLabel}: deltaReadsReviewComments but pair.json has no reviewComments`,
    };
  }
  return { ok: true, value: true };
}

/** A case that opts into the narrative or delta may not ask for a call the worker would skip. */
function readOptInSpanSkip(
  fixture: PairFixture,
  properties: CaseProperties,
  readsReviewComments: boolean,
): string | undefined {
  if (!readsRevisionSpan(properties)) {
    return undefined;
  }
  return readSpanSkip(
    {
      revised: fixture.revised,
      prevHeadSha: fixture.base.commitRange.head,
      filteredSpan: fixture.filteredSpan,
      reviewComments: readsReviewComments ? (fixture.reviewComments ?? []) : [],
    },
    properties.deltaProperties.length > 0,
  );
}

function readsRevisionSpan(
  properties: Pick<CaseProperties, "narrativeProperties" | "deltaProperties">,
): boolean {
  return (
    properties.narrativeProperties.length > 0 ||
    properties.deltaProperties.length > 0
  );
}

function shapePairFixture(
  data: z.infer<typeof PairFixtureSchema>,
): PairFixture {
  const { increment } = data;
  const fixture: PairFixture = {
    base: toEvalFixture(data.base),
    revised: toEvalFixture(data.revised),
    filteredSpan: increment.filteredSpan,
    unfilteredSpan: increment.unfilteredSpan,
  };

  if (data.baseBrief !== undefined) {
    fixture.baseBrief = data.baseBrief;
  }
  if (data.reviewComments !== undefined) {
    fixture.reviewComments = data.reviewComments;
  }
  return fixture;
}

/** Zod optionals infer `| undefined`; EvalFixture is exact-optional. */
function toEvalFixture(value: z.infer<typeof FixtureSchema>): EvalFixture {
  const repoContext = toRepoContext(value.repoContext);
  const fixture: EvalFixture = {
    pr: toFetchedPr(value.pr),
    commitRange: value.commitRange,
  };

  if (repoContext !== undefined) {
    fixture.repoContext = repoContext;
  }

  return fixture;
}

export interface PairRunResult {
  pairs: RevisionPair[];
  /** Index-aligned with `pairs`; empty when the case does not opt in. */
  narratives: NarrativeRun[];
  deltas: DeltaRun[];
  /** 1-based run number that produced `pairs[i]` (failed runs leave gaps). */
  runNumbers: number[];
  generationFailures: number;
  failureMessages: string[];
}

/**
 * `anchored` = the production path (plan → anchored categorize → stitch).
 * `fresh` = the vacuous-pass probe: BOTH generations run fresh, no anchor
 * view, no stitch, the anchoring-dependent properties MUST fail here, or
 * they are vacuous.
 */
export type PairRunMode = "anchored" | "fresh";

/**
 * The span the worker would read for the pair. Fixtures carry no merge base,
 * so one PR base under both heads stands for the fast path; any other pair
 * is built from both PR diffs and the unfiltered span's per-file patches.
 */
export function readPairSpan(fixture: PairFixture): PrSpan {
  const { base, revised, unfilteredSpan } = fixture;
  if (base.commitRange.base === revised.commitRange.base) {
    return buildFastForwardSpan({
      betweenHeadsDiff: unfilteredSpan,
      newPrDiff: revised.pr.diff,
    });
  }

  const files = splitDiffByFile(unfilteredSpan);
  const betweenHeads = new Map(
    files.map(({ file, patch }) => [
      file,
      { kind: BetweenHeadsKinds.PATCH, patch },
    ]),
  );
  return buildPrSpan({
    prevPrDiff: base.pr.diff,
    newPrDiff: revised.pr.diff,
    betweenHeads,
  });
}

/** The anchor plan the revised run takes over `previousBrief`, with no model call. */
export function planPairAnchoring(
  fixture: PairFixture,
  previousBrief: Brief,
): AnchorPlan {
  return planAnchoredGeneration({ previousBrief, span: readPairSpan(fixture) });
}

function makeFixtureOptions(
  fixture: EvalFixture,
  headIndex: number,
  generator: Generator,
  effort: Effort,
): GenerateBriefOptions {
  return {
    pr: fixture.pr,
    headIndex,
    commitRange: fixture.commitRange,
    generator,
    effort,
    repoContext: fixture.repoContext,
    gitAttributes: fixture.gitAttributes,
    multiCallHooks: {},
  };
}

async function readBaseBrief(
  fixture: PairFixture,
  generator: Generator,
  effort: Effort,
): Promise<Brief> {
  if (fixture.baseBrief !== undefined) {
    return fixture.baseBrief;
  }
  const { brief } = await generateBrief(
    makeFixtureOptions(fixture.base, BASE_BRIEF_INDEX, generator, effort),
  );
  return brief;
}

async function runPair(
  fixture: PairFixture,
  generator: Generator,
  effort: Effort,
  mode: PairRunMode,
): Promise<RevisionPair> {
  const base = await readBaseBrief(fixture, generator, effort);
  const revisedOptions = makeFixtureOptions(
    fixture.revised,
    REVISED_BRIEF_INDEX,
    generator,
    effort,
  );

  if (mode === "fresh") {
    // No stitch and no anchor stamp, the anchored-path guarantees are
    // absent by design. The plan rides along for inspection.
    const plan = planPairAnchoring(fixture, base);
    const { brief: revised } = await generateBrief(revisedOptions);
    return { base, revised, plan };
  }

  const { brief: revised, anchoring } = await generateBrief({
    ...revisedOptions,
    previous: { brief: base, span: readPairSpan(fixture) },
  });
  if (anchoring === undefined) {
    throw new Error("anchored run returned no plan");
  }
  return {
    base,
    revised: { ...revised, anchor: { state: AnchorStates.ANCHORED } },
    plan: anchoring.plan,
  };
}

interface PairRun {
  pair: RevisionPair;
  narrative?: NarrativeRun;
  delta?: DeltaRun;
}

/** One run: the pair, then the narrative and the delta the case opts into. */
async function runPairWithSpan(
  pairCase: PairCase,
  generator: Generator,
  effort: Effort,
  mode: PairRunMode,
): Promise<PairRun> {
  const { fixture } = pairCase;
  const pair = await runPair(fixture, generator, effort, mode);
  const run: PairRun = { pair };
  if (!readsRevisionSpan(pairCase)) {
    return run;
  }

  const inputs: RevisionSpanInputs = {
    revised: fixture.revised,
    prevHeadSha: fixture.base.commitRange.head,
    filteredSpan: fixture.filteredSpan,
    reviewComments: selectDeltaComments(pairCase),
    generator,
    effort,
  };
  if (pairCase.narrativeProperties.length > 0) {
    run.narrative = await generateNarrativeRun(inputs, pair.revised);
  }
  if (pairCase.deltaProperties.length > 0) {
    run.delta = await generateDeltaRun(inputs);
  }
  return run;
}

function selectDeltaComments(pairCase: PairCase): readonly ReviewComment[] {
  if (!pairCase.deltaReadsReviewComments) {
    return [];
  }
  return pairCase.fixture.reviewComments ?? [];
}

/**
 * The case as a mode runs it. The delta never reads the revised Brief, so the
 * fresh probe has nothing to show about it and drops its properties.
 */
function scopePairCaseToMode(pairCase: PairCase, mode: PairRunMode): PairCase {
  if (mode === "anchored") {
    return pairCase;
  }
  return { ...pairCase, deltaProperties: [] };
}

/**
 * The baseline without the ids a mode scoped out of the case, so a dropped
 * property reads absent rather than stale.
 */
function scopeBaselineToCase(
  baseline: CaseBaseline | null,
  unscopedCase: PairCase,
  pairCase: PairCase,
): CaseBaseline | null {
  if (baseline === null) {
    return baseline;
  }
  const kept = new Set(pairCase.deltaProperties.map((property) => property.id));
  const dropped = new Set(
    unscopedCase.deltaProperties
      .map((property) => property.id)
      .filter((id) => !kept.has(id)),
  );
  const properties = Object.entries(baseline.properties).filter(
    ([id]) => !dropped.has(id),
  );
  return { ...baseline, properties: Object.fromEntries(properties) };
}

/** Model calls one run of the case makes, multi-call Briefs counted as one. */
export function countPairGenerations(
  pairCase: PairCase,
  mode: PairRunMode = "anchored",
): number {
  const scoped = scopePairCaseToMode(pairCase, mode);
  const baseCalls = scoped.fixture.baseBrief === undefined ? 1 : 0;
  // An unchanged span writes the no-change records with no model call.
  const spanCalls = isSpanUnchanged(scoped.fixture.filteredSpan) ? 0 : 1;
  const narrativeCalls = scoped.narrativeProperties.length > 0 ? spanCalls : 0;
  const deltaCalls = scoped.deltaProperties.length > 0 ? spanCalls : 0;
  return baseCalls + 1 + narrativeCalls + deltaCalls;
}

/**
 * Run a pair case N times, serially (same posture as `runCase`). A failure
 * anywhere in a run, either Brief, the stitch, the narrative or the delta,
 * voids that whole run and is recorded.
 */
export async function runPairCase(
  unscopedCase: PairCase,
  generator: Generator,
  effort: Effort,
  runs: number,
  progress: (message: string) => void = () => {},
  mode: PairRunMode = "anchored",
): Promise<PairRunResult> {
  const pairCase = scopePairCaseToMode(unscopedCase, mode);
  const result: PairRunResult = {
    pairs: [],
    narratives: [],
    deltas: [],
    runNumbers: [],
    generationFailures: 0,
    failureMessages: [],
  };
  for (let run = 1; run <= runs; run++) {
    progress(
      `  ${pairCase.id}: run ${run}/${runs} (${countPairGenerations(pairCase)} generations)…`,
    );
    try {
      // oxlint-disable-next-line no-await-in-loop -- serial by design (see runCase)
      const pairRun = await runPairWithSpan(pairCase, generator, effort, mode);
      collectPairRun(result, pairRun, run);
    } catch (error) {
      result.failureMessages.push(
        `run ${run}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  result.generationFailures = result.failureMessages.length;
  return result;
}

function collectPairRun(
  result: PairRunResult,
  pairRun: PairRun,
  runNumber: number,
): void {
  result.pairs.push(pairRun.pair);
  result.runNumbers.push(runNumber);
  if (pairRun.narrative !== undefined) {
    result.narratives.push(pairRun.narrative);
  }
  if (pairRun.delta !== undefined) {
    result.deltas.push(pairRun.delta);
  }
}

export interface PairScoredRuns {
  scores: Map<string, { passes: number; runs: number }>;
  notes: string[];
}

/** Score one property list against every run, mirror of `scoreRuns`. */
export function scorePairRuns<Run>(
  properties: readonly ScoredProperty<Run>[],
  runs: readonly Run[],
): PairScoredRuns {
  const duplicate = findDuplicateId(properties);
  if (duplicate !== undefined) {
    throw new Error(`duplicate property id "${duplicate}"`);
  }
  const scores = new Map<string, { passes: number; runs: number }>();
  const notes: string[] = [];
  for (const property of properties) {
    const scored = scorePairProperty(property, runs);
    notes.push(...scored.notes);
    scores.set(property.id, { passes: scored.passes, runs: runs.length });
  }
  return { scores, notes };
}

/** One property over every run: a throwing check is a fail plus a note. */
function scorePairProperty<Run>(
  property: ScoredProperty<Run>,
  runs: readonly Run[],
): { passes: number; notes: string[] } {
  let passes = 0;
  const notes: string[] = [];
  for (const [index, run] of runs.entries()) {
    try {
      if (property.check(run)) {
        passes += 1;
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      notes.push(
        `property "${property.id}" threw on run ${index + 1}: ${reason} (counted as fail)`,
      );
    }
  }

  return { passes, notes };
}

/** The pair, narrative and delta lists scored into one map, in that order. */
function scorePairCase(
  pairCase: PairCase,
  result: PairRunResult,
): PairScoredRuns {
  const parts = [
    scorePairRuns(pairCase.properties, result.pairs),
    scorePairRuns(pairCase.narrativeProperties, result.narratives),
    scorePairRuns(pairCase.deltaProperties, result.deltas),
  ];
  return {
    scores: new Map(parts.flatMap((part) => [...part.scores])),
    notes: parts.flatMap((part) => part.notes),
  };
}

/** Generic case shape the source selector needs. */
interface SelectableCase {
  id: string;
}

/**
 * Select across BOTH sources: `--case` may name a single OR a pair case; an
 * id in neither is the error; an empty combined source is the error.
 */
export function selectCases<S extends SelectableCase, P extends SelectableCase>(
  singles: readonly S[],
  pairs: readonly P[],
  caseId: string | undefined,
): Result<{ singles: S[]; pairs: P[] }, string> {
  let selectedSingles = [...singles];
  let selectedPairs = [...pairs];
  if (caseId !== undefined) {
    selectedSingles = selectedSingles.filter((c) => c.id === caseId);
    selectedPairs = selectedPairs.filter((c) => c.id === caseId);
    if (selectedSingles.length + selectedPairs.length === 0) {
      const available = [...singles, ...pairs].map((c) => c.id).join(", ");
      return {
        ok: false,
        error: `unknown case "${caseId}" — available: ${available || "(none)"}`,
      };
    }
  }
  if (selectedSingles.length + selectedPairs.length === 0) {
    return { ok: false, error: "no cases found — the case set is empty" };
  }
  return {
    ok: true,
    value: { singles: selectedSingles, pairs: selectedPairs },
  };
}

/**
 * Both Briefs persist, since flaky pair properties need base AND revised
 * specimens; the narrative and the delta persist when the case opts in.
 */
function persistPairSpecimens(
  pairCase: PairCase,
  outDir: string,
  result: PairRunResult,
): void {
  const caseDir = join(outDir, "eval-runs", pairCase.id);
  const { runNumbers, failureMessages } = result;
  const sides = new Map<string, unknown[]>([
    ["base", result.pairs.map((pair) => pair.base)],
    ["revised", result.pairs.map((pair) => pair.revised)],
  ]);
  if (pairCase.narrativeProperties.length > 0) {
    sides.set(
      "narrative",
      result.narratives.map((run) => run.narrative),
    );
  }
  if (pairCase.deltaProperties.length > 0) {
    sides.set(
      "delta",
      result.deltas.map((run) => run.delta),
    );
  }

  for (const [side, briefs] of sides) {
    persistRunBriefs(join(caseDir, side), {
      briefs,
      runNumbers,
      failureMessages,
    });
  }
}

export interface EvaluatedPairCase {
  outcome: CaseOutcome;
  /** Rebaseline mode only: true when this case's baseline was written. */
  rebaselined: boolean;
}

/**
 * Evaluate one pair case end to end: run, persist BOTH sides' specimens,
 * score, load-or-write the baseline. Lives here, not in the CLI, so the
 * whole path is coverable with a fake generator.
 */
export async function evaluatePairCase(
  unscopedCase: PairCase,
  generator: Generator,
  effort: Effort,
  runs: number,
  key: string,
  baselineMode: BaselineMode,
  outDir: string,
  progress: (message: string) => void,
  mode: PairRunMode = "anchored",
): Promise<Result<EvaluatedPairCase, string>> {
  const pairCase = scopePairCaseToMode(unscopedCase, mode);
  const result = await runPairCase(
    pairCase,
    generator,
    effort,
    runs,
    progress,
    mode,
  );
  persistPairSpecimens(pairCase, outDir, result);
  const scored = scorePairCase(pairCase, result);
  const baselinePath = join(pairCase.dir, "baseline.json");
  let baseline: CaseOutcome["baseline"] = null;
  let rebaselined = false;
  if (baselineMode === BaselineModes.COMPARE) {
    const loaded = loadBaseline(baselinePath, key);
    if (!loaded.ok) {
      return loaded;
    }
    baseline = scopeBaselineToCase(loaded.value, unscopedCase, pairCase);
  } else if (baselineMode === BaselineModes.REBASELINE) {
    if (result.generationFailures > 0) {
      progress(
        `  ${pairCase.id}: NOT rebaselining — ${result.generationFailures} run failures`,
      );
      for (const message of result.failureMessages) {
        progress(`    ${message}`);
      }
    } else {
      saveBaseline(baselinePath, {
        key,
        runs: result.pairs.length,
        properties: Object.fromEntries(
          [...scored.scores.entries()].map(([id, score]) => [id, score.passes]),
        ),
      });
      rebaselined = true;
      progress(`  ${pairCase.id}: baseline written (${key})`);
    }
  }
  // NONE: characterization, scores report with no comparison.
  return {
    ok: true,
    value: {
      outcome: {
        caseId: pairCase.id,
        runsRequested: runs,
        runsScored: result.pairs.length,
        generationFailures: result.generationFailures,
        properties: [
          ...pairCase.properties,
          ...pairCase.narrativeProperties,
          ...pairCase.deltaProperties,
        ],
        scores: scored.scores,
        baseline,
        notes: [
          ...result.failureMessages,
          ...scored.notes,
          ...textLengthNotes(
            result.pairs.map((pair) => pair.base),
            "base",
          ),
          ...textLengthNotes(
            result.pairs.map((pair) => pair.revised),
            "revised",
          ),
        ],
      },
      rebaselined,
    },
  };
}
