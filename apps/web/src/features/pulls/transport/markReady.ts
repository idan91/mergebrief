// The mark-ready mutation over the isomorphic apiFetch boundary. Expected
// failure statuses are RESULT KINDS the own-draft flow renders as toast copy,
// never throws for those; only a malformed 2xx throws (contract violation).
//
// Deterministic-400 mirroring: the ready route's only 400 is a malformed
// :prNumber: unreachable from a valid UI state, so there is no cap/budget
// mirror to keep in lockstep. A 400 collapses into the generic upstream kind.
//
// The operation is idempotent server-side, so retrying after any failure kind
// is always safe.
import type { QueryKey } from "@tanstack/react-query";

import {
  ApiError,
  ApiErrorCodes,
  apiFetch,
  errorFromResponse,
  type ApiErrorCode,
} from "../../../data/apiFetch";
import { buildPrMetaQueryOptions } from "../queries";
import {
  MarkReadyResultKinds,
  type MarkReadyResult,
  type MarkReadyResultKind,
} from "./types";

type MarkReadyFailureKind = Exclude<
  MarkReadyResultKind,
  typeof MarkReadyResultKinds.READY
>;

// Total over the wire vocabulary: a new ApiErrorCode member fails to compile
// here instead of silently becoming "try again shortly". A 403 on this route
// is ONLY the missing `contents: write` (the fresh-resolve denial collapses
// to 404 server-side); `forbidden` covers the codeless-403 fallback. The
// route's only 400 is a malformed :prNumber, unreachable from a valid UI
// state: so invalid-request stays in the generic upstream bucket. Retrying
// any kind is safe: the operation is idempotent server-side.
const KindForCode = {
  [ApiErrorCodes.UNAUTHORIZED]: MarkReadyResultKinds.UNAUTHORIZED,
  [ApiErrorCodes.INVALID_SIGNATURE]: MarkReadyResultKinds.UPSTREAM,
  [ApiErrorCodes.FORBIDDEN]: MarkReadyResultKinds.GITHUB_PERMISSION,
  [ApiErrorCodes.GITHUB_PERMISSION]: MarkReadyResultKinds.GITHUB_PERMISSION,
  [ApiErrorCodes.SCOPE_EXCEEDED]: MarkReadyResultKinds.UPSTREAM,
  [ApiErrorCodes.HUMAN_ONLY]: MarkReadyResultKinds.UPSTREAM,
  [ApiErrorCodes.NO_REPO_WRITE_ACCESS]: MarkReadyResultKinds.NO_WRITE_ACCESS,
  [ApiErrorCodes.REPO_ADMIN_ONLY]: MarkReadyResultKinds.UPSTREAM,
  [ApiErrorCodes.ATTACHMENTS_DISABLED]: MarkReadyResultKinds.UPSTREAM,
  [ApiErrorCodes.ATTACHMENTS_ADMIN_ONLY]: MarkReadyResultKinds.UPSTREAM,
  [ApiErrorCodes.NOT_FOUND]: MarkReadyResultKinds.NOT_FOUND,
  [ApiErrorCodes.INVALID_REQUEST]: MarkReadyResultKinds.UPSTREAM,
  [ApiErrorCodes.ATTACHMENT_UNSUPPORTED_TYPE]: MarkReadyResultKinds.UPSTREAM,
  [ApiErrorCodes.NOT_A_PR_URL]: MarkReadyResultKinds.UPSTREAM,
  [ApiErrorCodes.SIGN_IN_FAILED]: MarkReadyResultKinds.UPSTREAM,
  [ApiErrorCodes.REQUEST_TOO_LARGE]: MarkReadyResultKinds.UPSTREAM,
  [ApiErrorCodes.DIFF_TOO_LARGE]: MarkReadyResultKinds.UPSTREAM,
  // Read-only codes: this write transport cannot receive any of them.
  [ApiErrorCodes.FILE_NOT_FOUND]: MarkReadyResultKinds.UPSTREAM,
  [ApiErrorCodes.FILE_TOO_LARGE]: MarkReadyResultKinds.UPSTREAM,
  [ApiErrorCodes.FILE_NOT_TEXT]: MarkReadyResultKinds.UPSTREAM,
  [ApiErrorCodes.DRAFT_ALREADY_PUBLISHED]: MarkReadyResultKinds.UPSTREAM,
  [ApiErrorCodes.DRAFT_ANCHOR_ORPHANED]: MarkReadyResultKinds.UPSTREAM,
  [ApiErrorCodes.DRAFT_LIMIT_REACHED]: MarkReadyResultKinds.UPSTREAM,
  [ApiErrorCodes.SESSION_RECORD_LIMIT_REACHED]: MarkReadyResultKinds.UPSTREAM,
  [ApiErrorCodes.DRAFT_PUBLISH_PENDING]: MarkReadyResultKinds.UPSTREAM,
  [ApiErrorCodes.DRAFT_PUBLISH_IN_DOUBT]: MarkReadyResultKinds.UPSTREAM,
  [ApiErrorCodes.ATTACHMENT_LIMIT_REACHED]: MarkReadyResultKinds.UPSTREAM,
  [ApiErrorCodes.PENDING_REVIEW_HELD]: MarkReadyResultKinds.UPSTREAM,
  [ApiErrorCodes.PR_CHANGED_SINCE_READ]: MarkReadyResultKinds.UPSTREAM,
  [ApiErrorCodes.PR_REWRITTEN_SINCE_READ]: MarkReadyResultKinds.UPSTREAM,
  [ApiErrorCodes.APP_NOT_INSTALLED]: MarkReadyResultKinds.UPSTREAM,
  [ApiErrorCodes.GITHUB_UNAVAILABLE]: MarkReadyResultKinds.UPSTREAM,
  [ApiErrorCodes.GENERATION_FAILED]: MarkReadyResultKinds.UPSTREAM,
  [ApiErrorCodes.GENERATION_UNAVAILABLE]: MarkReadyResultKinds.UPSTREAM,
  [ApiErrorCodes.GENERATION_CONFIG]: MarkReadyResultKinds.UPSTREAM,
  [ApiErrorCodes.INTERNAL_ERROR]: MarkReadyResultKinds.UPSTREAM,
  // Web-local; never on the wire: errorFromResponse cannot produce it.
  [ApiErrorCodes.MALFORMED]: MarkReadyResultKinds.UPSTREAM,
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
    return { kind: KindForCode[code] };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ApiError(ApiErrorCodes.MALFORMED, response.status, path);
  }
  if (!isReadyBody(body)) {
    throw new ApiError(ApiErrorCodes.MALFORMED, response.status, path);
  }
  return { kind: MarkReadyResultKinds.READY };
}

/** The invalidation boundary the action needs, a `QueryClient` satisfies it. */
export interface PrMetaInvalidator {
  invalidateQueries(filters: { queryKey: QueryKey }): Promise<void>;
}

/**
 * Build the route-injected mark-ready action. On success it invalidates the
 * PR-meta query and AWAITS the refetch before resolving, the own-draft UI
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
    if (result.kind === MarkReadyResultKinds.READY) {
      await client.invalidateQueries({
        queryKey: buildPrMetaQueryOptions(repoId, prNumber).queryKey,
      });
    }
    return result;
  };
}
