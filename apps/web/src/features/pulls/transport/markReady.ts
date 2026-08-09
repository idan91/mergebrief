// The mark-ready mutation over the isomorphic apiFetch boundary (BRIEF-43 PR 3).
// Client-only in practice (a user click), but it rides the same boundary as every
// mutation. Expected failure statuses are RESULT KINDS the own-draft flow
// renders as toast copy — never throws for those; only a malformed 2xx throws
// (contract violation).
//
// Deterministic-400 mirroring (apps/web AGENTS.md): the ready route's only
// 400 is a malformed :prNumber — unreachable from a valid UI state (the route
// param comes from the already-validated PR view), so there is no cap/budget
// mirror to keep in lockstep. A 400 collapses into the generic upstream kind.
//
// The operation is idempotent server-side (an already-ready PR converges to
// the same 200), so retrying after any failure kind is always safe.
import type { QueryKey } from "@tanstack/react-query";

import { ApiError, ApiErrorKind, apiFetch } from "../../../data/apiFetch";
import { prMetaQueryOptions } from "../queries";

export type MarkReadyResult =
  /** The PR is ready — fresh flip or already-ready convergence (indistinguishable). */
  | { kind: "ready" }
  | { kind: "unauthorized" }
  | { kind: "not-found" }
  /**
   * GitHub blocked the mutation for lack of an App permission (the route's
   * `403 {"error":"github-permission"}`): `markPullRequestReadyForReview`
   * requires the App to hold `contents: write`. A distinct kind so the FE
   * gives honest, actionable copy instead of the "no longer accessible" 404
   * copy — the viewer proved repo access, so this is not an existence miss.
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
  // A 403 from this route is ONLY the mutation-stage `github-permission` gap
  // (the fresh-resolve denial collapses to 404 server-side) — the App is
  // missing `contents: write`. Distinct copy, recoverable after the owner
  // updates the App's permissions.
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
 * Build the route-injected mark-ready action (BRIEF-43). On success it
 * invalidates the PR-meta query and AWAITS the refetch before resolving —
 * the own-draft UI keys off the plan derived from PR-meta, so resolving only
 * after the refreshed PrView landed is what keeps the state stable (no
 * optimistic clear, no flicker: pending holds until the flip is real). On
 * every failure kind it resolves WITHOUT touching the cache — the caller
 * toasts and stays in-state.
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
