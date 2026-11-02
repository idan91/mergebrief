// The PR-meta revision and comparison views: what a client reads off a
// revision, and why a comparison is unavailable.
import type { ValueOf } from "types/utils";

/** Response vocabulary only, never stored, so no DB CHECK and no migration. */
export const LastReviewUnavailableReasons = {
  /** No marks and no live generation: GC'd baseline or rewritten history. */
  BASELINE_UNAVAILABLE: "baseline-unavailable",
  /** No marks yet, but a delta generation for the span is still non-terminal. */
  PENDING: "pending",
  /** No marks: GitHub would not render the span, and a delta skip record stands in for it. */
  SPAN_TOO_LARGE: "span-too-large",
} as const;
export type LastReviewUnavailableReason = ValueOf<
  typeof LastReviewUnavailableReasons
>;

/** Marks existence IS the offer; `deltaAvailable` is optional richness. */
export interface AvailableLastReviewComparisonView {
  readonly deltaAvailable: boolean;
  /** No delta will come: the span was too large for one call or the call was cut, and a skip record stands in for it. */
  readonly deltaSkipped?: true;
  /** No Delta Brief is owed: the PR's own change did not move since the checkpoint. */
  readonly deltaUnchanged?: true;
  readonly baselineSha: string;
  /** The baseline's brief index when the checkpoint SHA was a briefed head. */
  readonly baselineIndex?: number;
}

export type LastReviewComparisonView =
  | AvailableLastReviewComparisonView
  | { readonly unavailable: LastReviewUnavailableReason };

export interface AvailablePreviousBriefComparisonView {
  readonly baselineSha: string;
  readonly baselineIndex: number;
  readonly narrativeAvailable: boolean;
  /** The PR's own change did not move since the previous brief; the narrative is the no-change record. */
  readonly unchanged?: true;
}

/** A previous brief exists but its span has no marks; the reasons mean what they mean for `lastReview`. */
export interface UnavailablePreviousBriefComparisonView {
  readonly baselineSha: string;
  readonly baselineIndex: number;
  readonly unavailable: LastReviewUnavailableReason;
}

export type PreviousBriefComparisonView =
  | AvailablePreviousBriefComparisonView
  | UnavailablePreviousBriefComparisonView;

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
