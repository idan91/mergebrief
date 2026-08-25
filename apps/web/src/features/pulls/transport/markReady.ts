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

import {
  ApiError,
  ApiErrorCode,
  apiFetch,
  errorFromResponse,
} from "../../../data/apiFetch";
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
  /**
   * 403 — a url-box brief for a repo the reader's own GitHub account cannot
   * write to. Never a retry: it clears by installing the App there.
   */
  | { kind: "no-write-access" }
  | { kind: "upstream" };

type MarkReadyFailureKind = Exclude<MarkReadyResult["kind"], "ready">;

// Total over the wire vocabulary: a new ApiErrorCode member fails to compile
// here instead of silently becoming "try again shortly". A 403 on this route
// is ONLY the missing `contents: write` (the fresh-resolve denial collapses
// to 404 server-side); `forbidden` covers the codeless-403 fallback. The
// route's only 400 is a malformed :prNumber — unreachable from a valid UI
// state — so invalid-request stays in the generic upstream bucket. Retrying
// any kind is safe: the operation is idempotent server-side.
const KIND_FOR_CODE = {
  [ApiErrorCode.UNAUTHORIZED]: "unauthorized",
  [ApiErrorCode.INVALID_SIGNATURE]: "upstream",
  [ApiErrorCode.FORBIDDEN]: "github-permission",
  [ApiErrorCode.GITHUB_PERMISSION]: "github-permission",
  [ApiErrorCode.SCOPE_EXCEEDED]: "upstream",
  [ApiErrorCode.HUMAN_ONLY]: "upstream",
  [ApiErrorCode.NO_REPO_WRITE_ACCESS]: "no-write-access",
  [ApiErrorCode.NOT_FOUND]: "not-found",
  [ApiErrorCode.INVALID_REQUEST]: "upstream",
  [ApiErrorCode.NOT_A_PR_URL]: "upstream",
  [ApiErrorCode.SIGN_IN_FAILED]: "upstream",
  [ApiErrorCode.REQUEST_TOO_LARGE]: "upstream",
  [ApiErrorCode.DIFF_TOO_LARGE]: "upstream",
  [ApiErrorCode.DRAFT_ALREADY_PUBLISHED]: "upstream",
  [ApiErrorCode.DRAFT_ANCHOR_ORPHANED]: "upstream",
  [ApiErrorCode.DRAFT_LIMIT_REACHED]: "upstream",
  [ApiErrorCode.PR_CHANGED_SINCE_READ]: "upstream",
  [ApiErrorCode.PR_REWRITTEN_SINCE_READ]: "upstream",
  [ApiErrorCode.APP_NOT_INSTALLED]: "upstream",
  [ApiErrorCode.GITHUB_UNAVAILABLE]: "upstream",
  [ApiErrorCode.GENERATION_FAILED]: "upstream",
  [ApiErrorCode.GENERATION_UNAVAILABLE]: "upstream",
  [ApiErrorCode.GENERATION_CONFIG]: "upstream",
  [ApiErrorCode.INTERNAL_ERROR]: "upstream",
  // Web-local; never on the wire — errorFromResponse cannot produce it.
  [ApiErrorCode.MALFORMED]: "upstream",
} as const satisfies Record<ApiErrorCode, MarkReadyFailureKind>;

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
  if (!response.ok) {
    const { code } = await errorFromResponse(response, path);
    return { kind: KIND_FOR_CODE[code] };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ApiError(ApiErrorCode.MALFORMED, response.status, path);
  }
  if (!isReadyBody(body)) {
    throw new ApiError(ApiErrorCode.MALFORMED, response.status, path);
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
