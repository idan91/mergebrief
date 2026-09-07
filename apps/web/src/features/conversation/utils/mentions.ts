import type { MentionCandidate } from "@web/components/MarkdownTextarea/useMentionAutocomplete";
import type { ConversationThread } from "../types";
import type { Mutable } from "types";

/**
 * Mention-autocomplete pool for a thread's reply box: the humans already in
 * the conversation, first-seen order, deduped. Bots are excluded. Entries
 * carry the payload's author avatar; display names come only from the
 * collaborators merge, the conversation payload has none.
 */
export function mentionCandidatesFromThread(
  thread: ConversationThread,
): readonly MentionCandidate[] {
  const byLogin = new Map<string, MentionCandidate>();
  for (const comment of thread.comments) {
    if (comment.author.isBot || byLogin.has(comment.author.login)) continue;
    const candidate: Mutable<MentionCandidate> = {
      login: comment.author.login,
    };

    if (comment.author.avatarUrl !== undefined) {
      candidate.avatarUrl = comment.author.avatarUrl;
    }

    byLogin.set(comment.author.login, candidate);
  }
  return [...byLogin.values()];
}

/**
 * The thread composer's full pool. Pool order is the autocomplete's RANKING
 * (the hook prefix-filters in array order, capped): participants first,
 * keeping their first-seen position but picking up the collaborator entry's
 * name/avatar by login match, then the remaining collaborators as given.
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
    const merged: Mutable<MentionCandidate> = { login: participant.login };

    if (name !== undefined) merged.name = name;
    if (avatarUrl !== undefined) merged.avatarUrl = avatarUrl;

    return merged;
  });
  return [
    ...enriched,
    ...collaborators.filter((collaborator) => !seen.has(collaborator.login)),
  ];
}
