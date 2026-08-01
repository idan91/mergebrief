import type { MentionCandidate } from "@web/components/MarkdownTextarea/useMentionAutocomplete";
import type { ConversationThread } from "../types";

/**
 * Mention-autocomplete pool for a thread's reply box (BRIEF-56 decision 7):
 * the humans already in the conversation, first-seen order, deduped. Bots
 * are excluded — mentioning one from a review reply is never the intent.
 * Login-only entries (the conversation payload carries no name/avatar);
 * the collaborators merge enriches them (BRIEF-94).
 */
export function mentionCandidatesFromThread(
  thread: ConversationThread,
): readonly MentionCandidate[] {
  const logins = [
    ...new Set(
      thread.comments
        .filter((comment) => !comment.author.isBot)
        .map((comment) => comment.author.login),
    ),
  ];
  return logins.map((login) => ({ login }));
}
