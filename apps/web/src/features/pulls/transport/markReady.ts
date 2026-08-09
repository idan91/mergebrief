// The mark-ready mutation over the isomorphic apiFetch boundary. Expected
// failure statuses are RESULT KINDS the own-draft flow renders as toast copy —
// never throws for those; only a malformed 2xx throws (contract violation).
//
// Deterministic-400 mirroring: the ready route's only 400 is a malformed
// :prNumber — unreachable from a valid UI state — so there is no cap/budget
// mirror to keep in lockstep. A 400 collapses into the generic upstream kind.
//
// The operation is idempotent server-side, so retrying after any failure kind
// is always safe.
import type { QueryKey } from "@tanstack/react-query";

import { ApiError, ApiErrorKind, apiFetch } from "../../../data/apiFetch";
import { prMetaQueryOptions } from "../queries";

export type MarkReadyResult =
  /** The PR is ready — fresh flip or already-ready convergence (indistinguishable). */
  | { kind: "ready" }
  | { kind: "unauthorized" }
  | { kind: "not-found" }
  /**
   * 403 — the App lacks `contents: write`. A distinct kind so the FE gives
   * actionable copy instead of the "no longer accessible" 404 copy: the viewer
   * proved repo access, so this is not an existence miss.
   */
  | { kind: "github-permission" }
  | { kind: "upstream" };

/** The route-injected action shape the Brief screen's own-draft flow calls. */
export type MarkReadyAction = () => Promise<MarkReadyResult>;

function isReadyBody(value: unknown): value is { draft: false } {
  return (
    typeof value === "object" &&
    value !== null &&
    "draft" in value &&
    value.draft === false
  );
}

export async function markPrReady(
  repoId: string,
  prNumber: number,
): Promise<MarkReadyResult> {
  const path = `/api/repos/${encodeURIComponent(repoId)}/pulls/${String(prNumber)}/ready`;
  const response = await apiFetch(path, { method: "POST" });
  if (response.status === 401) {
    return { kind: "unauthorized" };
  }
  if (response.status === 404) {
    return { kind: "not-found" };
  }
  // A 403 here is ONLY the missing `contents: write` — the fresh-resolve
  // denial collapses to 404 server-side.
  if (response.status === 403) {
    return { kind: "github-permission" };
  }
  if (!response.ok) {
    return { kind: "upstream" };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ApiError(ApiErrorKind.MALFORMED, response.status, path);
  }
  if (!isReadyBody(body)) {
    throw new ApiError(ApiErrorKind.MALFORMED, response.status, path);
  }
  return { kind: "ready" };
}

/** The invalidation boundary the action needs — a `QueryClient` satisfies it. */
export interface PrMetaInvalidator {
  invalidateQueries(filters: { queryKey: QueryKey }): Promise<void>;
}

/**
 * Build the route-injected mark-ready action. On success it invalidates the
 * PR-meta query and AWAITS the refetch before resolving — the own-draft UI
 * keys off PR-meta, so pending must hold until the flip is real (no optimistic
 * clear, no flicker). Every failure kind resolves WITHOUT touching the cache.
 */
export function createMarkReadyAction(
  client: PrMetaInvalidator,
  repoId: string,
  prNumber: number,
  transport: (
    repoId: string,
    prNumber: number,
  ) => Promise<MarkReadyResult> = markPrReady,
): MarkReadyAction {
  return async () => {
    const result = await transport(repoId, prNumber);
    if (result.kind === "ready") {
      await client.invalidateQueries({
        queryKey: prMetaQueryOptions(repoId, prNumber).queryKey,
      });
    }
    return result;
  };
}
