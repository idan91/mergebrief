// react-query descriptor for the live conversation GET (BRIEF-25, ADR 0027).
// Refresh policy: refetch on navigation and window-focus (react-query
// defaults over a short staleTime) plus a manual refresh control (the
// section invalidates this key) — NO background poll. Expected failure
// statuses are RESULT KINDS the section renders as its error state (no
// fallback tier); only a malformed 200 throws (contract violation).
import { queryOptions } from "@tanstack/react-query";

import {
  ApiError,
  ApiErrorKind,
  apiFetch,
  apiJsonFromResponse,
} from "../../data/apiFetch";
import { parseConversation, type PrConversation } from "./types";

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
  return queryOptions({
    queryKey: conversationQueryKey(repoId, prNumber),
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
        throw new ApiError(ApiErrorKind.MALFORMED, response.status, path);
      }
      return { kind: "ready", conversation: parsed.value };
    },
    // The LOCKED refresh contract is refetch on navigation and window
    // focus (codex on the section PR): always-refetch on those events — the
    // server's 60s per-PR cache absorbs the cost, so this stays cheap while
    // never serving a stale section on return.
    staleTime: 30_000,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    gcTime: 5 * 60 * 1000,
    retry: false,
  });
}
