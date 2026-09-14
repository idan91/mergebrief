// The PR-meta revision and comparison views: what a client reads off a
// revision, and why a comparison is unavailable.
import type { ValueOf } from "types/utils";

/** Response vocabulary only, never stored, so no DB CHECK and no migration. */
export const LastReviewUnavailableReasons = {
  /** No marks and no live generation: GC'd baseline or rewritten history. */
  BASELINE_UNAVAILABLE: "baseline-unavailable",
  /** No marks yet, but a delta generation for the span is still non-terminal. */
  PENDING: "pending",
} as const;
export type LastReviewUnavailableReason = ValueOf<
  typeof LastReviewUnavailableReasons
>;

/** Marks existence IS the offer; `deltaAvailable` is optional richness the
 * worker skips on huge spans. */
export type LastReviewComparisonView =
  | {
      readonly deltaAvailable: boolean;
      readonly baselineSha: string;
      /** The baseline's brief index when the checkpoint SHA was a briefed head. */
      readonly baselineIndex?: number;
    }
  | { readonly unavailable: LastReviewUnavailableReason };

export interface PreviousBriefComparisonView {
  readonly baselineSha: string;
  readonly baselineIndex: number;
  readonly narrativeAvailable: boolean;
}

export interface RevisionComparisons {
  readonly previousBrief?: PreviousBriefComparisonView;
  readonly lastReview?: LastReviewComparisonView;
}

/**
 * A browsable Brief revision. `baseSha` is PER-ENTRY and critical: the base
 * drifts across revisions through a base-branch advance or a retarget, and the
 * brief GET is an exact `(pr, base, head)` lookup, so a consumer must never
 * derive base from the top-level view. Ordered by `headIndex`.
 */
export interface RevisionView {
  readonly headSha: string;
  readonly baseSha: string;
  readonly headIndex: number;
  readonly createdAt: string;
  /** When generation STARTED, which is the conversation cutoff: comments
   * newer than this postdate the brief. Falls back to `createdAt`. */
  readonly generatedAt: string;
  readonly comparisons: RevisionComparisons;
}
