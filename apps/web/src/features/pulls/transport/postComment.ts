// Expected failures are result kinds for own-draft toast copy; malformed 2xx responses throw.
// Keep body limits in lockstep with the route. The composer blocks empty bodies,
// postCommentBlockedReason blocks long ones, and anchors encode only true multiline ranges.
// Any remaining deterministic 400 requires editing the draft, never retrying unchanged.
import {
  ApiError,
  ApiErrorCodes,
  apiFetch,
  errorFromResponse,
  type ApiErrorCode,
} from "../../../data/apiFetch";
import {
  parsePostedComment,
  type PostedComment,
} from "../../../data/postedComment";

export type PostCommentResult =
  | PostedComment
  /** 401, session expired; sign in again. The draft stays. */
  | { readonly kind: "unauthorized" }
  /** 404, the PR (or repo access) is gone. */
  | { readonly kind: "not-found" }
  /** 409, the head advanced under the pinned commit; reload to re-anchor. */
  | { readonly kind: "stale" }
  /** 409, the draft's anchor points at no code; re-place or delete it. */
  | { readonly kind: "orphaned-anchor" }
  /** 409, the draft is already on GitHub; nothing posted twice. */
  | { readonly kind: "already-published" }
  /** 400 (shape; mirrored client-side) or deterministic 413, edit the body, retry-as-is never clears. */
  | { readonly kind: "invalid" }
  /** 502/anything else, GitHub rejected or is unreachable. */
  /**
   * 403, a url-box brief for a repo the reader's own GitHub account cannot
   * write to. Never a retry: it clears by installing the App there.
   */
  | { readonly kind: "no-write-access" }
  | { readonly kind: "upstream" };

type PostCommentFailureKind = Exclude<PostCommentResult["kind"], "posted">;

// Keep the wire mapping total so new codes cannot silently become retry advice.
// Frozen-session and rewritten-PR failures require reloading to re-anchor.
// Orphaned/published drafts are neither stale nor retryable; 413 requires a body edit.
const KindForCode = {
  [ApiErrorCodes.UNAUTHORIZED]: "unauthorized",
  [ApiErrorCodes.INVALID_SIGNATURE]: "upstream",
  [ApiErrorCodes.FORBIDDEN]: "upstream",
  [ApiErrorCodes.GITHUB_PERMISSION]: "upstream",
  [ApiErrorCodes.SCOPE_EXCEEDED]: "upstream",
  [ApiErrorCodes.HUMAN_ONLY]: "upstream",
  [ApiErrorCodes.NO_REPO_WRITE_ACCESS]: "no-write-access",
  [ApiErrorCodes.REPO_ADMIN_ONLY]: "upstream",
  [ApiErrorCodes.NOT_FOUND]: "not-found",
  [ApiErrorCodes.INVALID_REQUEST]: "invalid",
  [ApiErrorCodes.NOT_A_PR_URL]: "upstream",
  [ApiErrorCodes.SIGN_IN_FAILED]: "upstream",
  [ApiErrorCodes.REQUEST_TOO_LARGE]: "invalid",
  [ApiErrorCodes.DIFF_TOO_LARGE]: "upstream",
  // Read-only codes: this write transport cannot receive any of them.
  [ApiErrorCodes.FILE_NOT_FOUND]: "upstream",
  [ApiErrorCodes.FILE_TOO_LARGE]: "upstream",
  [ApiErrorCodes.FILE_NOT_TEXT]: "upstream",
  [ApiErrorCodes.DRAFT_ALREADY_PUBLISHED]: "already-published",
  [ApiErrorCodes.DRAFT_ANCHOR_ORPHANED]: "orphaned-anchor",
  [ApiErrorCodes.DRAFT_LIMIT_REACHED]: "upstream",
  [ApiErrorCodes.PENDING_REVIEW_HELD]: "upstream",
  [ApiErrorCodes.PR_CHANGED_SINCE_READ]: "stale",
  [ApiErrorCodes.PR_REWRITTEN_SINCE_READ]: "stale",
  [ApiErrorCodes.APP_NOT_INSTALLED]: "upstream",
  [ApiErrorCodes.GITHUB_UNAVAILABLE]: "upstream",
  [ApiErrorCodes.GENERATION_FAILED]: "upstream",
  [ApiErrorCodes.GENERATION_UNAVAILABLE]: "upstream",
  [ApiErrorCodes.GENERATION_CONFIG]: "upstream",
  [ApiErrorCodes.INTERNAL_ERROR]: "upstream",
  // Web-local; never on the wire, errorFromResponse cannot produce it.
  [ApiErrorCodes.MALFORMED]: "upstream",
} as const satisfies Record<ApiErrorCode, PostCommentFailureKind>;

/**
 * The route posts a draft the SESSION holds: the anchor and body are already
 * stored, and the commit comes off the named Brief's head. All this carries
 * is which draft.
 */
export interface PostCommentPayload {
  readonly draftId: string;
}

export async function postInlineComment(
  repoId: string,
  prNumber: number,
  span: { base: string; head: string },
  payload: PostCommentPayload,
): Promise<PostCommentResult> {
  const query = `base=${encodeURIComponent(span.base)}&head=${encodeURIComponent(span.head)}`;
  const path = `/api/repos/${encodeURIComponent(repoId)}/pulls/${String(prNumber)}/comments?${query}`;
  const response = await apiFetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const { code } = await errorFromResponse(response, path);
    return { kind: KindForCode[code] };
  }
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    throw new ApiError(ApiErrorCodes.MALFORMED, response.status, path);
  }
  const posted = parsePostedComment(parsed);
  if (posted === undefined) {
    throw new ApiError(ApiErrorCodes.MALFORMED, response.status, path);
  }
  return posted;
}
