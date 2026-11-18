// Drop OUR Entry comment from the PR-level comments: it is the product's
// front door on GitHub, not conversation. Filtered by the EXACT stored id,
// never by author or body shape, so no other bot's comment and no human
// comment quoting ours can be swallowed. A mid-repost race can show the
// comment for at most one cache TTL.
import type { PrConversation } from "github";

export function stripEntryComment(
  conversation: PrConversation,
  entryCommentId: bigint | null,
): PrConversation {
  if (entryCommentId === null) {
    return conversation;
  }
  return {
    ...conversation,
    prComments: conversation.prComments.filter(
      (comment) => BigInt(comment.commentId) !== entryCommentId,
    ),
  };
}
