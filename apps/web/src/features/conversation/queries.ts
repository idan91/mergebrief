// react-query descriptors for the live conversation GET, referenced by
// routes. Refresh policy: refetch on navigation and window-focus plus a
// manual refresh control (the section invalidates this key) — NO background
// poll. Expected failure statuses are RESULT KINDS the section renders as its
// error state; only a malformed 200 throws (contract violation).
import { queryOptions, type QueryKey } from "@tanstack/react-query";

import type { MentionCandidate } from "@web/components/MarkdownTextarea/useMentionAutocomplete";
import {
  ApiError,
  ApiErrorCode,
  apiFetch,
  apiJsonFromResponse,
} from "../../data/apiFetch";
import {
  parseCollaborators,
  parseConversation,
  type PrConversation,
} from "./types";

export type ConversationResult =
  | { readonly kind: "ready"; readonly conversation: PrConversation }
  /** 401 — the session expired mid-review; sign in again. */
  | { readonly kind: "unauthorized" }
  /** 404 — the PR (or its conversation) is no longer accessible. */
  | { readonly kind: "not-found" }
  /** 502/503 — GitHub or the backend is unreachable; the section's error state. */
  | { readonly kind: "unavailable" };

export function conversationQueryKey(repoId: string, prNumber: number) {
  return ["conversation", repoId, prNumber] as const;
}

/**
 * The PR's live conversation. Server-side it is cached ~60s per PR on the
 * installation token; the short client staleTime keeps focus/navigation
 * refetches honest without hammering the shared budget.
 */
export function conversationQueryOptions(repoId: string, prNumber: number) {
  // Deliberately widened to `QueryKey`: the descriptor crosses plan
  // boundaries typed as plain UseQueryOptions, and a narrower inferred key
  // breaks that assignment (queryFn context contravariance).
  const queryKey: QueryKey = conversationQueryKey(repoId, prNumber);
  return queryOptions({
    queryKey,
    queryFn: async (): Promise<ConversationResult> => {
      const path = `/api/repos/${encodeURIComponent(repoId)}/pulls/${String(prNumber)}/conversation`;
      const response = await apiFetch(path);
      if (response.status === 401) {
        return { kind: "unauthorized" };
      }
      if (response.status === 404) {
        return { kind: "not-found" };
      }
      if (response.status === 502 || response.status === 503) {
        return { kind: "unavailable" };
      }
      const body = await apiJsonFromResponse(response, path);
      const parsed = parseConversation(body);
      if (!parsed.ok) {
        throw new ApiError(ApiErrorCode.MALFORMED, response.status, path);
      }
      return { kind: "ready", conversation: parsed.value };
    },
    // Always-refetch on navigation and window focus: the server's 60s per-PR
    // cache absorbs the cost, so a return never shows a stale section.
    staleTime: 30_000,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    gcTime: 5 * 60 * 1000,
    retry: false,
  });
}

export type CollaboratorsResult =
  /** Alphabetical by login — pool order is the autocomplete ranking. */
  | { readonly kind: "ready"; readonly candidates: readonly MentionCandidate[] }
  /**
   * 401/404/502/503 — all EXPECTED: 404 is the route's viewerCanPush denial,
   * the rest auth/upstream blips. The pool falls back to thread participants;
   * a mention pool never earns an error surface.
   */
  | { readonly kind: "unavailable" };

export function collaboratorsQueryKey(repoId: string) {
  return ["collaborators", repoId] as const;
}

/**
 * The repo's collaborator roster as mention candidates. Server-side it is
 * cached ~60s per repo on the installation token; the long client staleTime
 * reflects how slowly a roster churns — no focus-refetch, no poll.
 */
export function collaboratorsQueryOptions(repoId: string) {
  // Widened to `QueryKey` for the same contravariance reason as
  // conversationQueryOptions above.
  const queryKey: QueryKey = collaboratorsQueryKey(repoId);
  return queryOptions({
    queryKey,
    queryFn: async (): Promise<CollaboratorsResult> => {
      const path = `/api/repos/${encodeURIComponent(repoId)}/collaborators`;
      const response = await apiFetch(path);
      if (
        response.status === 401 ||
        response.status === 404 ||
        response.status === 502 ||
        response.status === 503
      ) {
        return { kind: "unavailable" };
      }
      const body = await apiJsonFromResponse(response, path);
      const parsed = parseCollaborators(body);
      if (!parsed.ok) {
        throw new ApiError(ApiErrorCode.MALFORMED, response.status, path);
      }
      const candidates = parsed.value.toSorted((a, b) =>
        a.login.localeCompare(b.login),
      );
      return { kind: "ready", candidates };
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
  });
}
