// Comments newer than the viewed revision's generation start postdate the
// brief. The cutoff is per-revision; an absent cutoff marks nothing. A comment
// this reviewer posted from the brief is never news to them, so it never marks.
import type { PrConversation } from "../types";

/** The fields of a thread or PR-level comment the cutoff check reads. */
export interface DatedComment {
  readonly createdAt: string;
  readonly reviewId?: number;
}

/** For a caller with no recorded submits, or comments that carry no review. */
export const NO_OWN_REVIEWS: ReadonlySet<number> = new Set();

/** True when a comment outside the own reviews is strictly newer than the cutoff. */
export function postdatesBrief(
  comment: DatedComment,
  briefGeneratedAt: string | undefined,
  ownReviewIds: ReadonlySet<number>,
): boolean {
  if (briefGeneratedAt === undefined) return false;
  if (comment.reviewId !== undefined && ownReviewIds.has(comment.reviewId)) {
    return false;
  }

  const created = Date.parse(comment.createdAt);
  const cutoff = Date.parse(briefGeneratedAt);
  if (Number.isNaN(created) || Number.isNaN(cutoff)) return false;
  return created > cutoff;
}

/** Every fetched conversation comment past the cutoff: thread + PR-level. */
export function countCommentsAfterBrief(
  conversation: PrConversation,
  briefGeneratedAt: string | undefined,
  ownReviewIds: ReadonlySet<number>,
): number {
  if (briefGeneratedAt === undefined) return 0;
  let count = 0;
  for (const thread of conversation.threads) {
    for (const comment of thread.comments) {
      if (postdatesBrief(comment, briefGeneratedAt, ownReviewIds)) count += 1;
    }
  }
  for (const comment of conversation.prComments) {
    if (postdatesBrief(comment, briefGeneratedAt, ownReviewIds)) count += 1;
  }
  return count;
}
