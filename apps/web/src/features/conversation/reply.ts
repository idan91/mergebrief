// Reply transport: replies post IMMEDIATELY with the viewer's token,
// GitHub's create-review comments[] has no in_reply_to, so there is no
// batched alternative. Expected failure statuses are RESULT KINDS the
// composer renders; only a malformed 2xx throws (contract violation).
import {
  ApiError,
  ApiErrorCodes,
  apiFetch,
  errorFromResponse,
  type ApiErrorCode,
} from "../../data/apiFetch";
import {
  parsePostedComment,
  type PostedComment,
} from "../../data/postedComment";

/** The Brief a reply was written from; the API records the reply against it. */
export interface ReplyBriefSpan {
  readonly base: string;
  readonly head: string;
}

export type ReplyResult =
  | PostedComment
  /** 401: session expired; sign in again. Draft stays. */
  | { readonly kind: "unauthorized" }
  /** 404: the thread's root comment (or the PR) is gone. */
  | { readonly kind: "not-found" }
  /** 400 (shape; mirrored client-side) or deterministic 413, edit the body, retry-as-is never clears. */
  | { readonly kind: "invalid" }
  /**
   * 403: the reader is on a url-box brief for a repo their own GitHub
   * account cannot write to. Never a retry: it clears by installing the App
   * on that repository, not by trying again.
   */
  | { readonly kind: "no-write-access" }
  /** 502/anything else: GitHub rejected or is unreachable. */
  | { readonly kind: "upstream" };

/** Mirror of the route's Zod cap: a deterministic 400 must block client-side. */
export const MAX_REPLY_LENGTH = 65_536;

type ReplyFailureKind = Exclude<ReplyResult["kind"], "posted">;

// Total over the wire vocabulary: a new ApiErrorCode member fails to compile
// here instead of silently becoming "try again shortly". A 413 is
// deterministic (over-long body): edit, never retry-as-is.
const KindForCode = {
  [ApiErrorCodes.UNAUTHORIZED]: "unauthorized",
  [ApiErrorCodes.INVALID_SIGNATURE]: "upstream",
  [ApiErrorCodes.FORBIDDEN]: "upstream",
  [ApiErrorCodes.GITHUB_PERMISSION]: "upstream",
  [ApiErrorCodes.SCOPE_EXCEEDED]: "upstream",
  [ApiErrorCodes.HUMAN_ONLY]: "upstream",
  [ApiErrorCodes.NO_REPO_WRITE_ACCESS]: "no-write-access",
  [ApiErrorCodes.REPO_ADMIN_ONLY]: "upstream",
  [ApiErrorCodes.ATTACHMENTS_DISABLED]: "upstream",
  [ApiErrorCodes.ATTACHMENTS_ADMIN_ONLY]: "upstream",
  [ApiErrorCodes.NOT_FOUND]: "not-found",
  [ApiErrorCodes.INVALID_REQUEST]: "invalid",
  [ApiErrorCodes.ATTACHMENT_UNSUPPORTED_TYPE]: "invalid",
  [ApiErrorCodes.NOT_A_PR_URL]: "upstream",
  [ApiErrorCodes.SIGN_IN_FAILED]: "upstream",
  [ApiErrorCodes.REQUEST_TOO_LARGE]: "invalid",
  [ApiErrorCodes.DIFF_TOO_LARGE]: "upstream",
  // Read-only codes: this write transport cannot receive any of them.
  [ApiErrorCodes.FILE_NOT_FOUND]: "upstream",
  [ApiErrorCodes.FILE_TOO_LARGE]: "upstream",
  [ApiErrorCodes.FILE_NOT_TEXT]: "upstream",
  [ApiErrorCodes.DRAFT_ALREADY_PUBLISHED]: "upstream",
  [ApiErrorCodes.DRAFT_ANCHOR_ORPHANED]: "upstream",
  [ApiErrorCodes.DRAFT_LIMIT_REACHED]: "upstream",
  [ApiErrorCodes.PENDING_REVIEW_HELD]: "upstream",
  [ApiErrorCodes.PR_CHANGED_SINCE_READ]: "upstream",
  [ApiErrorCodes.PR_REWRITTEN_SINCE_READ]: "upstream",
  [ApiErrorCodes.APP_NOT_INSTALLED]: "upstream",
  [ApiErrorCodes.GITHUB_UNAVAILABLE]: "upstream",
  [ApiErrorCodes.GENERATION_FAILED]: "upstream",
  [ApiErrorCodes.GENERATION_UNAVAILABLE]: "upstream",
  [ApiErrorCodes.GENERATION_CONFIG]: "upstream",
  [ApiErrorCodes.INTERNAL_ERROR]: "upstream",
  // Web-local; never on the wire: errorFromResponse cannot produce it.
  [ApiErrorCodes.MALFORMED]: "upstream",
} as const satisfies Record<ApiErrorCode, ReplyFailureKind>;

export async function postConversationReply(
  repoId: string,
  prNumber: number,
  span: ReplyBriefSpan,
  rootCommentId: number,
  body: string,
): Promise<ReplyResult> {
  const query = `base=${encodeURIComponent(span.base)}&head=${encodeURIComponent(span.head)}`;
  const path = `/api/repos/${encodeURIComponent(repoId)}/pulls/${String(prNumber)}/comments/${String(rootCommentId)}/replies?${query}`;
  const response = await apiFetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ body }),
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
