import type { DraftPolicySummary } from "../types";

/** The two PR-meta fields the hold reads (a `PrSummary` slice). */
export interface DraftHoldSource {
  readonly draft: boolean;
  readonly draftPolicy?: DraftPolicySummary;
}

/**
 * A draft on an instance whose drafts policy is off: a push, a review or a
 * review request only records state, and the next run queues when the pull
 * request is marked ready for review. A meta with no policy reads the
 * zero-config default, which generates drafts.
 */
export function awaitsReadyForReview({
  draft,
  draftPolicy,
}: DraftHoldSource): boolean {
  const draftsSkipped = draftPolicy?.generate === false;
  const held = draft && draftsSkipped;
  return held;
}
