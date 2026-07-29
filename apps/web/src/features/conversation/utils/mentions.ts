import type { ConversationThread } from "../types";

/**
 * Mention-autocomplete pool for a thread's reply box (BRIEF-56 decision 7):
 * the humans already in the conversation, first-seen order, deduped. Bots
 * are excluded — mentioning one from a review reply is never the intent.
 */
export function mentionCandidatesFromThread(
  thread: ConversationThread,
): readonly string[] {
  return [
    ...new Set(
      thread.comments
        .filter((comment) => !comment.author.isBot)
        .map((comment) => comment.author.login),
    ),
  ];
}
