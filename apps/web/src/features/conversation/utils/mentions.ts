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

/**
 * The thread composer's full pool (BRIEF-94 decision 6). Pool order is the
 * autocomplete's RANKING (the hook prefix-filters in array order, capped):
 * participants first — they keep their first-seen position but pick up the
 * collaborator entry's name/avatar by login match — then the remaining
 * collaborators in the order given (the query sorts them alphabetically).
 */
export function mergeMentionCandidates(
  participants: readonly MentionCandidate[],
  collaborators: readonly MentionCandidate[],
): readonly MentionCandidate[] {
  const byLogin = new Map(
    collaborators.map((collaborator) => [collaborator.login, collaborator]),
  );
  const seen = new Set(participants.map((participant) => participant.login));
  const enriched = participants.map((participant) => {
    const rich = byLogin.get(participant.login);
    if (rich === undefined) return participant;
    const name = participant.name ?? rich.name;
    const avatarUrl = participant.avatarUrl ?? rich.avatarUrl;
    return {
      login: participant.login,
      ...(name === undefined ? {} : { name }),
      ...(avatarUrl === undefined ? {} : { avatarUrl }),
    };
  });
  return [
    ...enriched,
    ...collaborators.filter((collaborator) => !seen.has(collaborator.login)),
  ];
}
