// react-query descriptors for the live conversation GET, referenced by
// routes. Refresh policy: refetch on navigation and window-focus plus a
// manual refresh control (the section invalidates this key): NO background
// poll. Expected failure statuses are RESULT KINDS the section renders as its
// error state; only a malformed 200 throws (contract violation).
import { queryOptions, type QueryKey } from "@tanstack/react-query";
import { MentionQueryKeys, ProductQueryIds } from "contract";
import { HttpStatuses } from "types/http";

import { ApiError } from "../../data/apiFetch";
import { request } from "../../data/request";
import {
  mentionSuggestionsResponseSchema,
  prConversationSchema,
} from "./schemas";
import {
  MentionSearchResultKinds,
  type MentionSearchResult,
  type PrConversation,
} from "./types";
import { shapeTeamCandidate, shapeUserCandidate } from "./utils/mentions";

export type ConversationResult =
  | { readonly kind: "ready"; readonly conversation: PrConversation }
  /** 401: the session expired mid-review; sign in again. */
  | { readonly kind: "unauthorized" }
  /** 404: the PR (or its conversation) is no longer accessible. */
  | { readonly kind: "not-found" }
  /** 502/503: GitHub or the backend is unreachable; the section's error state. */
  | { readonly kind: "unavailable" };

type ConversationFailure = Exclude<ConversationResult, { kind: "ready" }>;

const ConversationFailureByStatus: Readonly<
  Partial<Record<number, ConversationFailure>>
> = {
  [HttpStatuses.UNAUTHORIZED]: { kind: "unauthorized" },
  [HttpStatuses.NOT_FOUND]: { kind: "not-found" },
  [HttpStatuses.BAD_GATEWAY]: { kind: "unavailable" },
  [HttpStatuses.SERVICE_UNAVAILABLE]: { kind: "unavailable" },
};

/** The status's expected failure, or `undefined` for one the query should throw. */
function readExpectedFailure<Failure>(
  error: unknown,
  failures: Readonly<Partial<Record<number, Failure>>>,
): Failure | undefined {
  if (!(error instanceof ApiError)) {
    return undefined;
  }
  return failures[error.status];
}

async function readConversation(
  repoId: string,
  prNumber: number,
): Promise<ConversationResult> {
  try {
    const conversation = await request(
      ProductQueryIds.READ_CONVERSATION,
      { params: { repoId, prNumber } },
      prConversationSchema,
    );
    return { kind: "ready", conversation };
  } catch (error) {
    const failure = readExpectedFailure(error, ConversationFailureByStatus);
    if (failure === undefined) {
      throw error;
    }
    return failure;
  }
}

export function buildConversationQueryKey(repoId: string, prNumber: number) {
  return ["conversation", repoId, prNumber] as const;
}

/**
 * The PR's live conversation. Server-side it is cached ~60s per PR on the
 * installation token; the short client staleTime keeps focus/navigation
 * refetches honest without hammering the shared budget.
 */
export function buildConversationQueryOptions(
  repoId: string,
  prNumber: number,
) {
  // Deliberately widened to `QueryKey`: the descriptor crosses plan
  // boundaries typed as plain UseQueryOptions, and a narrower inferred key
  // breaks that assignment (queryFn context contravariance).
  const queryKey: QueryKey = buildConversationQueryKey(repoId, prNumber);
  return queryOptions({
    queryKey,
    queryFn: () => readConversation(repoId, prNumber),
    // Always-refetch on navigation and window focus: the server's 60s per-PR
    // cache absorbs the cost, so a return never shows a stale section.
    staleTime: 30_000,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    gcTime: 5 * 60 * 1000,
  });
}

const MENTION_SEARCH_STALE_MS = 60_000;

const MentionSearchUnavailableStatuses: Readonly<
  Partial<Record<number, typeof MentionSearchResultKinds.UNAVAILABLE>>
> = {
  [HttpStatuses.UNAUTHORIZED]: MentionSearchResultKinds.UNAVAILABLE,
  [HttpStatuses.NOT_FOUND]: MentionSearchResultKinds.UNAVAILABLE,
  [HttpStatuses.BAD_GATEWAY]: MentionSearchResultKinds.UNAVAILABLE,
  [HttpStatuses.SERVICE_UNAVAILABLE]: MentionSearchResultKinds.UNAVAILABLE,
};

async function searchMentionSuggestions(
  repoId: string,
  query: string,
): Promise<MentionSearchResult> {
  try {
    const found = await request(
      ProductQueryIds.SEARCH_MENTION_SUGGESTIONS,
      { params: { repoId }, query: { [MentionQueryKeys.QUERY]: query } },
      mentionSuggestionsResponseSchema,
    );
    const users = found.users.map(shapeUserCandidate);
    const teams = found.teams.map(shapeTeamCandidate);
    return { kind: MentionSearchResultKinds.READY, query, users, teams };
  } catch (error) {
    const failure = readExpectedFailure(
      error,
      MentionSearchUnavailableStatuses,
    );
    if (failure === undefined) {
      throw error;
    }
    return { kind: failure, query };
  }
}

function buildMentionSuggestionsQueryKey(repoId: string, loweredQuery: string) {
  return ["mention-suggestions", repoId, loweredQuery] as const;
}

/**
 * What GitHub offers for the text typed after `@`, keyed by its lowercased
 * form since GitHub matches without case. The server caches the same answer
 * for a minute; a retry is the next keystroke, so none runs here.
 */
export function buildMentionSuggestionsQueryOptions(
  repoId: string,
  query: string,
) {
  const lowered = query.toLowerCase();
  return queryOptions({
    queryKey: buildMentionSuggestionsQueryKey(repoId, lowered),
    queryFn: () => searchMentionSuggestions(repoId, lowered),
    staleTime: MENTION_SEARCH_STALE_MS,
    retry: false,
  });
}
