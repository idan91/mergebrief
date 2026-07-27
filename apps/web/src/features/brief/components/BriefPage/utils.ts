// Closure-free BriefPage logic (ADR 0037 decision 3): derivations extracted
// from the screen/hooks so they are unit-testable directly, without rendering.
import type { ComparisonQuery } from "../../comparison/comparisonQuery";
import {
  buildChunkComparisonView,
  type ComparisonMarkFiles,
} from "../../comparison/comparison";
import type { BriefChunk, IntentCheck } from "../../types";

/** Typed placeholder for a plan slot that is absent — always `enabled: false`. */
export function disabledComparisonQuery<T>(slot: string): ComparisonQuery<T> {
  return {
    queryKey: ["comparison-plan-disabled", slot],
    queryFn: () => Promise.reject(new Error("comparison query disabled")),
  };
}

/**
 * Total contiguous marked runs across the brief's chunks — the comparison
 * overlay's jump-nav count. 0 without marks (overlay off or unavailable).
 */
export function countComparisonRuns(
  chunks: BriefChunk[],
  marks: ComparisonMarkFiles | null,
): number {
  if (marks === null) return 0;
  return chunks.reduce(
    (total, chunk) =>
      total + buildChunkComparisonView(chunk, marks).runs.length,
    0,
  );
}

/**
 * BRIEF-54 soft-gate line: count of precise stated-but-missing asks. Zero on
 * broad/none (the bar is unavailable) or a pre-feature Brief — the modal line
 * renders only when this is > 0. This never feeds the gate's OPEN condition,
 * so intent gaps alone never open the modal.
 */
export function countIntentGaps(intentCheck: IntentCheck | undefined): number {
  return intentCheck?.specificity === "precise"
    ? intentCheck.statedButMissing.length
    : 0;
}

/**
 * BRIEF-85 soft-gate line 2: count of precise intent TENSIONS — unacknowledged
 * deviations plus claimed-but-unachieved. Acknowledged deviations are excluded
 * on purpose: the description already owns that reversal, so nudging the
 * author about it at the gate would be nagging them with their own words.
 * Precise-only and caller-gated, exactly like `countIntentGaps`, and equally
 * never part of the gate's OPEN condition.
 */
export function countIntentTensions(
  intentCheck: IntentCheck | undefined,
): number {
  return intentCheck?.specificity === "precise"
    ? intentCheck.deviations.filter((item) => !item.acknowledged).length +
        intentCheck.claimedButUnachieved.length
    : 0;
}
