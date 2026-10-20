// react-query descriptors for the live conversation GET, referenced by
// routes. Refresh policy: refetch on navigation and window-focus plus a
// manual refresh control (the section invalidates this key): NO background
// poll. Expected failure statuses are RESULT KINDS the section renders as its
// error state; only a malformed 200 throws (contract violation).
import { queryOptions, type QueryKey } from "@tanstack/react-query";
import { ProductQueryIds } from "contract";
import { HttpStatuses } from "types/http";

import type { MentionUserCandidate } from "@web/components/MarkdownTextarea/types";
import { ApiError } from "../../data/apiFetch";
import { request } from "../../data/request";
import { collaboratorsResponseSchema, prConversationSchema } from "./schemas";
import type { PrConversation } from "./types";
import { shapeUserCandidate } from "./utils/mentions";

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

export type CollaboratorsResult =
  /** Alphabetical by login: pool order is the autocomplete ranking. */
  | {
      readonly kind: "ready";
      readonly candidates: readonly MentionUserCandidate[];
    }
  /**
   * 401/404/502/503, all EXPECTED: 404 is the route's viewerCanPush denial,
   * the rest auth/upstream blips. The pool falls back to thread participants;
   * a mention pool never earns an error surface.
   */
  | { readonly kind: "unavailable" };

const UNAVAILABLE_POOL = { kind: "unavailable" } as const;

const CollaboratorsFailureByStatus: Readonly<
  Partial<Record<number, typeof UNAVAILABLE_POOL>>
> = {
  [HttpStatuses.UNAUTHORIZED]: UNAVAILABLE_POOL,
  [HttpStatuses.NOT_FOUND]: UNAVAILABLE_POOL,
  [HttpStatuses.BAD_GATEWAY]: UNAVAILABLE_POOL,
  [HttpStatuses.SERVICE_UNAVAILABLE]: UNAVAILABLE_POOL,
};

async function listCollaborators(repoId: string): Promise<CollaboratorsResult> {
  try {
    const roster = await request(
      ProductQueryIds.LIST_COLLABORATORS,
      { params: { repoId } },
      collaboratorsResponseSchema,
    );
    const candidates = roster.collaborators
      .toSorted((left, right) => left.login.localeCompare(right.login))
      .map(shapeUserCandidate);
    return { kind: "ready", candidates };
  } catch (error) {
    const failure = readExpectedFailure(error, CollaboratorsFailureByStatus);
    if (failure === undefined) {
      throw error;
    }
    return failure;
  }
}

export function buildCollaboratorsQueryKey(repoId: string) {
  return ["collaborators", repoId] as const;
}

/**
 * The repo's collaborator roster as mention candidates. Server-side it is
 * cached ~60s per repo on the installation token; the long client staleTime
 * reflects how slowly a roster churns: no focus-refetch, no poll.
 */
export function buildCollaboratorsQueryOptions(repoId: string) {
  // Widened to `QueryKey` for the same contravariance reason as
  // buildConversationQueryOptions above.
  const queryKey: QueryKey = buildCollaboratorsQueryKey(repoId);
  return queryOptions({
    queryKey,
    queryFn: () => listCollaborators(repoId),
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}
