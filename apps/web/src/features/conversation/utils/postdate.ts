// BRIEF-95: comments newer than the viewed revision's generation start
// postdate the brief — its story cannot account for them. The cutoff is
// per-revision (an older revision honestly marks more); an absent cutoff
// (local path, legacy metas) marks nothing.
import type { PrConversation } from "../types";

/** True when the comment is strictly newer than the generation cutoff. */
export function postdatesBrief(
  commentCreatedAt: string,
  briefGeneratedAt: string | undefined,
): boolean {
  if (briefGeneratedAt === undefined) return false;
  const comment = Date.parse(commentCreatedAt);
  const cutoff = Date.parse(briefGeneratedAt);
  if (Number.isNaN(comment) || Number.isNaN(cutoff)) return false;
  return comment > cutoff;
}

/** Every fetched conversation comment past the cutoff: thread + PR-level. */
export function countCommentsAfterBrief(
  conversation: PrConversation,
  briefGeneratedAt: string | undefined,
): number {
  if (briefGeneratedAt === undefined) return 0;
  let count = 0;
  for (const thread of conversation.threads) {
    for (const comment of thread.comments) {
      if (postdatesBrief(comment.createdAt, briefGeneratedAt)) count += 1;
    }
  }
  for (const comment of conversation.prComments) {
    if (postdatesBrief(comment.createdAt, briefGeneratedAt)) count += 1;
  }
  return count;
}
