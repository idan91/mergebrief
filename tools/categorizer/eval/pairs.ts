import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod/v4";
import type { Result } from "types";
import { AnchorStates, categorize } from "brief-core";
import type { Brief } from "brief-core/types";
import type { Effort, Generator } from "generators";
import {
  planAnchoredGeneration,
  stitchBrief,
  type AnchorPlan,
  type CompareFiles,
} from "worker";
import { loadBaseline, saveBaseline } from "./baseline";
import { FixtureSchema, toRepoContext, type EvalFixture } from "./loadCase";
import type { CaseOutcome } from "./report";
import { persistRunBriefs } from "./specimens";

/**
 * Revision-pair cases (BRIEF-143 PR 5): a pair = a base fixture + a
 * constructed increment. The runner drives the SAME machinery production
 * runs — fresh categorize for the base, `planAnchoredGeneration` over the
 * increment, anchored categorize for the revision, `stitchBrief` for the
 * merged artifact — so the property pairs measure the real pipeline, not a
 * re-implementation. Each case's increment is provably scoped (authored
 * diffs over own-repo files; the compare metadata is part of the fixture).
 *
 * Baselines follow the BRIEF-59 discipline; a pair case without a
 * baseline.json reports scores with verdicts withheld (the CLI's normal
 * no-baseline posture) — baselines land via `--rebaseline --case <id>` as
 * an explicit reviewed commit AFTER the vacuous-pass check (README).
 */

const PairIncrementSchema = z.object({
  /** The prevHead→head span diff (raw unified diff). */
  incrementalDiff: z.string().min(1),
  /** The compare files[] metadata the worker would have fetched. */
  compareFiles: z.object({
    files: z.array(
      z.object({
        filename: z.string(),
        status: z.string(),
        previousFilename: z.string().optional(),
      }),
    ),
    complete: z.boolean(),
    status: z.string().optional(),
  }),
  baseShaMoved: z.boolean(),
});

const PairFixtureSchema = z.object({
  base: FixtureSchema,
  revised: FixtureSchema,
  increment: PairIncrementSchema,
});

export interface PairFixture {
  base: EvalFixture;
  revised: EvalFixture;
  increment: {
    incrementalDiff: string;
    compareFiles: CompareFiles;
    baseShaMoved: boolean;
  };
}

/** One scored revision pair: both persisted-shape briefs plus the plan. */
export interface RevisionPair {
  base: Brief;
  revised: Brief;
  plan: AnchorPlan;
}

/**
 * One mechanical predicate over a revision pair. Same register as
 * `EvalProperty` (BRIEF-59 decision 2): anchor on run-stable facts — group
 * survival, id carry, attribute presence, coverage — never chunk boundaries
 * or free prose.
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
}

function isPairProperty(value: unknown): value is PairEvalProperty {
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
 * `pairProperties`). A missing directory is an empty corpus, not an error —
 * the pair corpus lands incrementally.
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
    // eslint-disable-next-line no-await-in-loop -- sequential: first bad case aborts the load
    const loaded = await loadOnePair(id, join(pairsDir, id));
    if (!loaded.ok) return loaded;
    cases.push(loaded.value);
  }
  return { ok: true, value: cases };
}

async function loadOnePair(
  id: string,
  dir: string,
): Promise<Result<PairCase, string>> {
  const fixturePath = join(dir, "pair.json");
  if (!existsSync(fixturePath)) {
    return { ok: false, error: `pair case "${id}": missing pair.json` };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(fixturePath, "utf8"));
  } catch (error) {
    return {
      ok: false,
      error: `pair case "${id}": unreadable pair.json (${
        error instanceof Error ? error.message : String(error)
      })`,
    };
  }
  const parsed = PairFixtureSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: `pair case "${id}": invalid pair.json — ${z.prettifyError(parsed.error)}`,
    };
  }
  const expectedPath = join(dir, "expected.ts");
  if (!existsSync(expectedPath)) {
    return { ok: false, error: `pair case "${id}": missing expected.ts` };
  }
  const module: unknown = await import(pathToFileURL(expectedPath).href);
  const properties =
    typeof module === "object" && module !== null
      ? Reflect.get(module, "pairProperties")
      : undefined;
  if (!Array.isArray(properties) || !properties.every(isPairProperty)) {
    return {
      ok: false,
      error: `pair case "${id}": expected.ts must export \`pairProperties: PairEvalProperty[]\``,
    };
  }
  if (properties.length === 0) {
    return {
      ok: false,
      error: `pair case "${id}": expected.ts exports no properties`,
    };
  }
  // Duplicate ids refuse at LOAD time — before any generation spends money
  // (scorePairRuns keeps its own backstop for programmatic callers).
  const propertyIds = new Set<string>();
  for (const property of properties) {
    if (propertyIds.has(property.id)) {
      return {
        ok: false,
        error: `pair case "${id}": duplicate property id "${property.id}"`,
      };
    }
    propertyIds.add(property.id);
  }
  return {
    ok: true,
    value: {
      id,
      dir,
      fixture: {
        base: toEvalFixture(parsed.data.base),
        revised: toEvalFixture(parsed.data.revised),
        increment: {
          incrementalDiff: parsed.data.increment.incrementalDiff,
          baseShaMoved: parsed.data.increment.baseShaMoved,
          compareFiles: {
            files: parsed.data.increment.compareFiles.files.map((file) => ({
              filename: file.filename,
              status: file.status,
              ...(file.previousFilename === undefined
                ? {}
                : { previousFilename: file.previousFilename }),
            })),
            complete: parsed.data.increment.compareFiles.complete,
            ...(parsed.data.increment.compareFiles.status === undefined
              ? {}
              : { status: parsed.data.increment.compareFiles.status }),
          },
        },
      },
      properties,
    },
  };
}

/** Zod optionals infer `| undefined`; EvalFixture is exact-optional. */
function toEvalFixture(value: z.infer<typeof FixtureSchema>): EvalFixture {
  const repoContext = toRepoContext(value.repoContext);
  return {
    pr: value.pr,
    commitRange: value.commitRange,
    ...(repoContext === undefined ? {} : { repoContext }),
  };
}

export interface PairRunResult {
  pairs: RevisionPair[];
  /** 1-based run number that produced `pairs[i]` (failed runs leave gaps). */
  runNumbers: number[];
  generationFailures: number;
  failureMessages: string[];
}

/**
 * Run a pair case N times, serially (same posture as `runCase`): each run =
 * one fresh base generation + one anchored revision generation + the
 * production stitch. Any failure in the run — either generation, or a
 * stitch/coverage error — voids that run and is recorded.
 */
/**
 * `anchored` = the production path (plan → anchored categorize → stitch).
 * `fresh` = the vacuous-pass mode (README ritual): BOTH generations run
 * fresh, no anchor view, no stitch — the anchoring-dependent properties
 * (untouched survival, anchored stamp) MUST fail here, or they are vacuous.
 */
export type PairRunMode = "anchored" | "fresh";

export async function runPairCase(
  pairCase: PairCase,
  generator: Generator,
  effort: Effort,
  runs: number,
  progress: (message: string) => void = () => {},
  mode: PairRunMode = "anchored",
): Promise<PairRunResult> {
  const { fixture } = pairCase;
  const pairs: RevisionPair[] = [];
  const runNumbers: number[] = [];
  const failureMessages: string[] = [];
  for (let run = 1; run <= runs; run++) {
    progress(`  ${pairCase.id}: run ${run}/${runs} (base + revision)…`);
    try {
      // eslint-disable-next-line no-await-in-loop -- serial by design (see runCase)
      const base = await categorize(
        fixture.base.pr,
        1,
        fixture.base.commitRange,
        generator,
        () => {},
        fixture.base.repoContext,
        effort,
      );
      const plan = planAnchoredGeneration({
        previousBrief: base,
        incrementalDiff: fixture.increment.incrementalDiff,
        compareFiles: fixture.increment.compareFiles,
        baseShaMoved: fixture.increment.baseShaMoved,
      });
      // eslint-disable-next-line no-await-in-loop -- serial by design
      const generated = await categorize(
        fixture.revised.pr,
        2,
        fixture.revised.commitRange,
        generator,
        () => {},
        fixture.revised.repoContext,
        effort,
        mode === "anchored"
          ? {
              previousBrief: base,
              frozenGroupIds: plan.frozen.map((carry) => carry.group.id),
            }
          : undefined,
      );
      if (mode === "fresh") {
        // No stitch, no anchoring detail — the anchored-path guarantees are
        // absent, as under production's `full-regeneration: always` (which
        // stamps `anchor: none`; here the stamp is simply absent — the
        // anchoredStamp property fails either way). Plan rides for
        // inspection.
        pairs.push({ base, revised: generated, plan });
        runNumbers.push(run);
        continue;
      }
      const stitched = stitchBrief({
        generated,
        plan,
        prFiles: fixture.revised.pr.meta.files.map((file) => file.path),
      });
      if (!stitched.ok) {
        throw new Error(`stitch failed: ${stitched.error.message}`);
      }
      const revised: Brief = {
        ...stitched.value.brief,
        anchor: { state: AnchorStates.ANCHORED },
      };
      pairs.push({ base, revised, plan });
      runNumbers.push(run);
    } catch (error) {
      failureMessages.push(
        `run ${run}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return {
    pairs,
    runNumbers,
    generationFailures: failureMessages.length,
    failureMessages,
  };
}

export interface PairScoredRuns {
  scores: Map<string, { passes: number; runs: number }>;
  notes: string[];
}

/** Score pair properties against every run's pair — mirror of `scoreRuns`. */
export function scorePairRuns(
  properties: readonly PairEvalProperty[],
  pairs: readonly RevisionPair[],
): PairScoredRuns {
  const ids = new Set<string>();
  for (const property of properties) {
    if (ids.has(property.id)) {
      throw new Error(`duplicate property id "${property.id}"`);
    }
    ids.add(property.id);
  }
  const scores = new Map<string, { passes: number; runs: number }>();
  const notes: string[] = [];
  for (const property of properties) {
    let passes = 0;
    for (const [index, pair] of pairs.entries()) {
      try {
        if (property.check(pair)) passes += 1;
      } catch (error) {
        notes.push(
          `property "${property.id}" threw on run ${index + 1}: ${
            error instanceof Error ? error.message : String(error)
          } (counted as fail)`,
        );
      }
    }
    scores.set(property.id, { passes, runs: pairs.length });
  }
  return { scores, notes };
}

/** Generic case shape the corpus selector needs. */
interface SelectableCase {
  id: string;
}

/**
 * Select across BOTH corpora: `--case` may name a single OR a pair case; an
 * id in neither is the error; an empty combined corpus is the error.
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
    return { ok: false, error: "no cases found — the corpus is empty" };
  }
  return {
    ok: true,
    value: { singles: selectedSingles, pairs: selectedPairs },
  };
}

export interface EvaluatedPairCase {
  outcome: CaseOutcome;
  /** Rebaseline mode only: true when this case's baseline was written. */
  rebaselined: boolean;
}

/**
 * Evaluate one pair case end to end: run, persist BOTH sides' specimens,
 * score, and load-or-write the baseline (BRIEF-59 discipline). Lives here —
 * not in the CLI — so the whole path is coverable with a fake generator.
 */
export async function evaluatePairCase(
  pairCase: PairCase,
  generator: Generator,
  effort: Effort,
  runs: number,
  key: string,
  rebaseline: boolean,
  outDir: string,
  progress: (message: string) => void,
  mode: PairRunMode = "anchored",
): Promise<Result<EvaluatedPairCase, string>> {
  const result = await runPairCase(
    pairCase,
    generator,
    effort,
    runs,
    progress,
    mode,
  );
  // Both sides persist — flaky pair properties need base AND revised
  // specimens.
  persistRunBriefs(join(outDir, "eval-runs", pairCase.id, "base"), {
    briefs: result.pairs.map((pair) => pair.base),
    runNumbers: result.runNumbers,
    failureMessages: result.failureMessages,
  });
  persistRunBriefs(join(outDir, "eval-runs", pairCase.id, "revised"), {
    briefs: result.pairs.map((pair) => pair.revised),
    runNumbers: result.runNumbers,
    failureMessages: result.failureMessages,
  });
  const scored = scorePairRuns(pairCase.properties, result.pairs);
  const baselinePath = join(pairCase.dir, "baseline.json");
  let baseline: CaseOutcome["baseline"] = null;
  let rebaselined = false;
  if (!rebaseline) {
    const loaded = loadBaseline(baselinePath, key);
    if (!loaded.ok) return loaded;
    baseline = loaded.value;
  } else if (result.generationFailures > 0) {
    progress(
      `  ${pairCase.id}: NOT rebaselining — ${result.generationFailures} run failures`,
    );
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
  return {
    ok: true,
    value: {
      outcome: {
        caseId: pairCase.id,
        runsRequested: runs,
        runsScored: result.pairs.length,
        generationFailures: result.generationFailures,
        properties: pairCase.properties,
        scores: scored.scores,
        baseline,
        notes: [...result.failureMessages, ...scored.notes],
      },
      rebaselined,
    },
  };
}
