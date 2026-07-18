import type { ValueOf } from "types";

/**
 * BRIEF-59 decision 4 — rule-based verdicts, no statistics theater: at
 * n=5 a proportion test has no power, so the harness detects CLIFFS
 * (stable → broken), never drifts. Flaky properties are informational by
 * construction — a flaky property is itself a finding (the prompt
 * coin-flips there, or the property is badly written).
 */

/** Pass count over a set of scored runs for one property. */
export interface PropertyScore {
  passes: number;
  runs: number;
}

export const BaselineClasses = {
  STABLE_PASS: "stable-pass",
  FLAKY: "flaky",
  STABLE_FAIL: "stable-fail",
} as const;
export type BaselineClass = ValueOf<typeof BaselineClasses>;

export const Verdicts = {
  REGRESSION: "regression",
  WARN: "warn",
  IMPROVEMENT: "improvement",
  FLAKY_DELTA: "flaky-delta",
  UNCHANGED: "unchanged",
  INSUFFICIENT_RUNS: "insufficient-runs",
} as const;
export type Verdict = ValueOf<typeof Verdicts>;

/** Verdicts are withheld below this many scored runs on either side. */
export const MIN_VERDICT_RUNS = 5;

export function classifyBaseline(score: PropertyScore): BaselineClass {
  if (score.passes === score.runs) return BaselineClasses.STABLE_PASS;
  if (score.passes === 0) return BaselineClasses.STABLE_FAIL;
  return BaselineClasses.FLAKY;
}

export function verdictFor(
  baseline: PropertyScore,
  branch: PropertyScore,
): Verdict {
  if (baseline.runs < MIN_VERDICT_RUNS || branch.runs < MIN_VERDICT_RUNS) {
    return Verdicts.INSUFFICIENT_RUNS;
  }
  switch (classifyBaseline(baseline)) {
    case BaselineClasses.STABLE_PASS: {
      const failures = branch.runs - branch.passes;
      if (failures >= 2) return Verdicts.REGRESSION;
      if (failures === 1) return Verdicts.WARN;
      return Verdicts.UNCHANGED;
    }
    case BaselineClasses.FLAKY:
      return Verdicts.FLAKY_DELTA;
    case BaselineClasses.STABLE_FAIL:
      return branch.passes > 0 ? Verdicts.IMPROVEMENT : Verdicts.UNCHANGED;
  }
}
