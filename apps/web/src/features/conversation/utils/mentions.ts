import {
  MentionBounds,
  type ConversationAuthorView,
  type MentionTeamView,
} from "contract";
import type { Mutable } from "types/utils";

import {
  MentionCandidateKinds,
  type MentionCandidate,
  type MentionTeamCandidate,
  type MentionUserCandidate,
} from "@web/components/MarkdownTextarea/types";
import {
  MentionSearchResultKinds,
  type ConversationThread,
  type MentionSearchResult,
  type MentionSource,
  type MentionSuggestionUser,
  type PrConversation,
} from "../types";

/** A person GitHub offers, as the list shows them: the same fields, marked a user. */
export function shapeUserCandidate(
  user: MentionSuggestionUser,
): MentionUserCandidate {
  const candidate: Mutable<MentionUserCandidate> = {
    kind: MentionCandidateKinds.USER,
    login: user.login,
  };

  if (user.name !== undefined) {
    candidate.name = user.name;
  }
  if (user.avatarUrl !== undefined) {
    candidate.avatarUrl = user.avatarUrl;
  }

  return candidate;
}

/** A team GitHub offers, marked a team. */
export function shapeTeamCandidate(
  team: MentionTeamView,
): MentionTeamCandidate {
  return {
    kind: MentionCandidateKinds.TEAM,
    combinedSlug: team.combinedSlug,
    name: team.name,
  };
}

/** A search runs only with a repo to ask and text within the route's bound. */
export function isMentionSearchable(
  repoId: string | undefined,
  query: string | undefined,
): boolean {
  const hasRepoAndQuery = repoId !== undefined && query !== undefined;
  if (!hasRepoAndQuery) {
    return false;
  }
  return query.length <= MentionBounds.QUERY_LENGTH;
}

const NO_USERS: readonly MentionUserCandidate[] = [];
const NO_TEAMS: readonly MentionTeamCandidate[] = [];

function shapeAuthorCandidate(
  author: ConversationAuthorView,
): MentionUserCandidate {
  const candidate: Mutable<MentionUserCandidate> = {
    kind: MentionCandidateKinds.USER,
    login: author.login,
  };

  if (author.avatarUrl !== undefined) {
    candidate.avatarUrl = author.avatarUrl;
  }

  return candidate;
}

/** Human authors in the order given, each login once; GitHub logins ignore case. */
function collectParticipants(
  authors: readonly ConversationAuthorView[],
): readonly MentionUserCandidate[] {
  const byLogin = new Map<string, MentionUserCandidate>();
  for (const author of authors) {
    const key = author.login.toLowerCase();
    const botOrListed = author.isBot || byLogin.has(key);
    if (botOrListed) {
      continue;
    }
    byLogin.set(key, shapeAuthorCandidate(author));
  }

  const participants = [...byLogin.values()];
  return participants;
}

/**
 * The humans in one thread, first-seen order. Entries carry the payload's
 * avatar; the conversation payload has no display names.
 */
export function listThreadParticipants(
  thread: ConversationThread,
): readonly MentionUserCandidate[] {
  const authors = thread.comments.map((comment) => comment.author);
  return collectParticipants(authors);
}

/** Everyone who wrote in the conversation: thread comments, reviews, then PR comments. */
export function listConversationParticipants(
  conversation: PrConversation,
): readonly MentionUserCandidate[] {
  const authors = [
    ...conversation.threads.flatMap((thread) =>
      thread.comments.map((comment) => comment.author),
    ),
    ...conversation.reviews.map((review) => review.author),
    ...conversation.prComments.map((comment) => comment.author),
  ];
  return collectParticipants(authors);
}

/** The repo to search and the conversation's participants; none until it loads. */
export function buildMentionSource(
  repoId: string | undefined,
  conversation: PrConversation | undefined,
): MentionSource {
  const participants =
    conversation === undefined
      ? NO_USERS
      : listConversationParticipants(conversation);
  const source: Mutable<MentionSource> = { participants };

  if (repoId !== undefined) {
    source.repoId = repoId;
  }

  return source;
}

/** A thread's own participants rank first, then the rest of the conversation. */
export function buildThreadMentionSource(
  thread: ConversationThread,
  conversationSource: MentionSource | undefined,
): MentionSource {
  const threadParticipants = listThreadParticipants(thread);
  if (conversationSource === undefined) {
    return { participants: threadParticipants };
  }
  const participants = mergeParticipants(
    threadParticipants,
    conversationSource.participants,
  );
  return { ...conversationSource, participants };
}

/** The first list in its order, then the second's logins the first lacks. */
export function mergeParticipants(
  first: readonly MentionUserCandidate[],
  second: readonly MentionUserCandidate[],
): readonly MentionUserCandidate[] {
  const seen = new Set(
    first.map((participant) => participant.login.toLowerCase()),
  );
  const added = second.filter(
    (participant) => !seen.has(participant.login.toLowerCase()),
  );
  const merged = [...first, ...added];
  return merged;
}

function enrichParticipant(
  participant: MentionUserCandidate,
  githubUser: MentionUserCandidate | undefined,
): MentionUserCandidate {
  if (githubUser === undefined) {
    return participant;
  }
  const name = participant.name ?? githubUser.name;
  const avatarUrl = participant.avatarUrl ?? githubUser.avatarUrl;
  const enriched: Mutable<MentionUserCandidate> = {
    kind: MentionCandidateKinds.USER,
    login: participant.login,
  };

  if (name !== undefined) {
    enriched.name = name;
  }
  if (avatarUrl !== undefined) {
    enriched.avatarUrl = avatarUrl;
  }

  return enriched;
}

function isUserMatch(user: MentionUserCandidate, lowered: string): boolean {
  const loginMatches = user.login.toLowerCase().includes(lowered);
  const nameMatches = user.name?.toLowerCase().includes(lowered) ?? false;
  const matches = loginMatches || nameMatches;
  return matches;
}

function isTeamMatch(team: MentionTeamCandidate, lowered: string): boolean {
  const slugMatches = team.combinedSlug.toLowerCase().includes(lowered);
  const nameMatches = team.name.toLowerCase().includes(lowered);
  const matches = slugMatches || nameMatches;
  return matches;
}

/**
 * The list's order is its ranking: participants whose login starts with the
 * query, picking up GitHub's name and avatar, then GitHub's other users, then
 * its teams. An answer to an older query is narrowed to rows that still
 * match, so the list holds steady while the next answer loads.
 */
export function mergeMentionCandidates(
  query: string,
  participants: readonly MentionUserCandidate[],
  answer: MentionSearchResult | undefined,
): readonly MentionCandidate[] {
  const lowered = query.toLowerCase();
  const ready =
    answer?.kind === MentionSearchResultKinds.READY ? answer : undefined;
  const users = ready?.users ?? NO_USERS;
  const teams = ready?.teams ?? NO_TEAMS;
  const answersQuery = ready?.query === lowered;
  const shownUsers = answersQuery
    ? users
    : users.filter((user) => isUserMatch(user, lowered));
  const shownTeams = answersQuery
    ? teams
    : teams.filter((team) => isTeamMatch(team, lowered));

  const githubByLogin = new Map(
    users.map((user) => [user.login.toLowerCase(), user]),
  );
  const matched = participants
    .filter((participant) =>
      participant.login.toLowerCase().startsWith(lowered),
    )
    .map((participant) => {
      const loweredLogin = participant.login.toLowerCase();
      const githubUser = githubByLogin.get(loweredLogin);
      return enrichParticipant(participant, githubUser);
    });
  const listed = new Set(
    matched.map((participant) => participant.login.toLowerCase()),
  );
  const others = shownUsers.filter(
    (user) => !listed.has(user.login.toLowerCase()),
  );

  const candidates = [...matched, ...others, ...shownTeams];
  return candidates;
}
