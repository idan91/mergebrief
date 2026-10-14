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
import { parsePostedComment } from "../../../data/postedComment";
import {
  PostCommentResultKinds,
  type PostCommentResult,
  type PostCommentResultKind,
} from "@web/features/brief/model";

type PostCommentFailureKind = Exclude<
  PostCommentResultKind,
  typeof PostCommentResultKinds.POSTED
>;

// Keep the wire mapping total so new codes cannot silently become retry advice.
// Frozen-session and rewritten-PR failures require reloading to re-anchor.
// Orphaned/published drafts are neither stale nor retryable; 413 requires a body edit.
const KindForCode = {
  [ApiErrorCodes.UNAUTHORIZED]: PostCommentResultKinds.UNAUTHORIZED,
  [ApiErrorCodes.SIGNED_OUT]: PostCommentResultKinds.UNAUTHORIZED,
  [ApiErrorCodes.INVALID_SIGNATURE]: PostCommentResultKinds.UPSTREAM,
  [ApiErrorCodes.FORBIDDEN]: PostCommentResultKinds.UPSTREAM,
  [ApiErrorCodes.GITHUB_PERMISSION]: PostCommentResultKinds.GITHUB_PERMISSION,
  [ApiErrorCodes.SCOPE_EXCEEDED]: PostCommentResultKinds.UPSTREAM,
  [ApiErrorCodes.HUMAN_ONLY]: PostCommentResultKinds.UPSTREAM,
  [ApiErrorCodes.NO_REPO_WRITE_ACCESS]: PostCommentResultKinds.NO_WRITE_ACCESS,
  [ApiErrorCodes.REPO_ADMIN_ONLY]: PostCommentResultKinds.UPSTREAM,
  [ApiErrorCodes.ATTACHMENTS_DISABLED]: PostCommentResultKinds.UPSTREAM,
  [ApiErrorCodes.ATTACHMENTS_ADMIN_ONLY]: PostCommentResultKinds.UPSTREAM,
  [ApiErrorCodes.NOT_FOUND]: PostCommentResultKinds.NOT_FOUND,
  [ApiErrorCodes.INVALID_REQUEST]: PostCommentResultKinds.INVALID,
  [ApiErrorCodes.ATTACHMENT_UNSUPPORTED_TYPE]: PostCommentResultKinds.INVALID,
  [ApiErrorCodes.NOT_A_PR_URL]: PostCommentResultKinds.UPSTREAM,
  [ApiErrorCodes.SIGN_IN_FAILED]: PostCommentResultKinds.UPSTREAM,
  [ApiErrorCodes.REQUEST_TOO_LARGE]: PostCommentResultKinds.INVALID,
  [ApiErrorCodes.DIFF_TOO_LARGE]: PostCommentResultKinds.UPSTREAM,
  // Read-only codes: this write transport cannot receive any of them.
  [ApiErrorCodes.FILE_NOT_FOUND]: PostCommentResultKinds.UPSTREAM,
  [ApiErrorCodes.FILE_TOO_LARGE]: PostCommentResultKinds.UPSTREAM,
  [ApiErrorCodes.FILE_NOT_TEXT]: PostCommentResultKinds.UPSTREAM,
  [ApiErrorCodes.DRAFT_ALREADY_PUBLISHED]:
    PostCommentResultKinds.ALREADY_PUBLISHED,
  [ApiErrorCodes.DRAFT_ANCHOR_ORPHANED]: PostCommentResultKinds.ORPHANED_ANCHOR,
  [ApiErrorCodes.DRAFT_LIMIT_REACHED]: PostCommentResultKinds.UPSTREAM,
  [ApiErrorCodes.SESSION_RECORD_LIMIT_REACHED]: PostCommentResultKinds.UPSTREAM,
  [ApiErrorCodes.DRAFT_PUBLISH_PENDING]: PostCommentResultKinds.PUBLISH_PENDING,
  [ApiErrorCodes.DRAFT_PUBLISH_IN_DOUBT]:
    PostCommentResultKinds.PUBLISH_IN_DOUBT,
  [ApiErrorCodes.ATTACHMENT_LIMIT_REACHED]: PostCommentResultKinds.UPSTREAM,
  [ApiErrorCodes.PENDING_REVIEW_HELD]: PostCommentResultKinds.UPSTREAM,
  [ApiErrorCodes.PR_CHANGED_SINCE_READ]: PostCommentResultKinds.STALE,
  [ApiErrorCodes.PR_REWRITTEN_SINCE_READ]: PostCommentResultKinds.STALE,
  [ApiErrorCodes.GITHUB_UNAVAILABLE]: PostCommentResultKinds.UPSTREAM,
  [ApiErrorCodes.ARTIFACT_UNREADABLE]: PostCommentResultKinds.UPSTREAM,
  [ApiErrorCodes.INTERNAL_ERROR]: PostCommentResultKinds.UPSTREAM,
  // Web-local; never on the wire, errorFromResponse cannot produce it.
  [ApiErrorCodes.MALFORMED]: PostCommentResultKinds.UPSTREAM,
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
