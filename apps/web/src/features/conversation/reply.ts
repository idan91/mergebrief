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
import { parsePostedComment } from "../../data/postedComment";
import {
  ReplyResultKinds,
  type ReplyResult,
  type ReplyResultKind,
} from "./types";

/** The Brief a reply was written from; the API records the reply against it. */
export interface ReplyBriefSpan {
  readonly base: string;
  readonly head: string;
}

/** Mirror of the route's Zod cap: a deterministic 400 must block client-side. */
export const MAX_REPLY_LENGTH = 65_536;

type ReplyFailureKind = Exclude<
  ReplyResultKind,
  typeof ReplyResultKinds.POSTED
>;

// Total over the wire vocabulary: a new ApiErrorCode member fails to compile
// here instead of silently becoming "try again shortly". A 413 is
// deterministic (over-long body): edit, never retry-as-is.
const KindForCode = {
  [ApiErrorCodes.UNAUTHORIZED]: ReplyResultKinds.UNAUTHORIZED,
  [ApiErrorCodes.SIGNED_OUT]: ReplyResultKinds.UNAUTHORIZED,
  [ApiErrorCodes.INVALID_SIGNATURE]: ReplyResultKinds.UPSTREAM,
  [ApiErrorCodes.FORBIDDEN]: ReplyResultKinds.UPSTREAM,
  [ApiErrorCodes.GITHUB_PERMISSION]: ReplyResultKinds.UPSTREAM,
  [ApiErrorCodes.SCOPE_EXCEEDED]: ReplyResultKinds.UPSTREAM,
  [ApiErrorCodes.HUMAN_ONLY]: ReplyResultKinds.UPSTREAM,
  [ApiErrorCodes.NO_REPO_WRITE_ACCESS]: ReplyResultKinds.NO_WRITE_ACCESS,
  [ApiErrorCodes.REPO_ADMIN_ONLY]: ReplyResultKinds.UPSTREAM,
  [ApiErrorCodes.ATTACHMENTS_DISABLED]: ReplyResultKinds.UPSTREAM,
  [ApiErrorCodes.ATTACHMENTS_ADMIN_ONLY]: ReplyResultKinds.UPSTREAM,
  [ApiErrorCodes.NOT_FOUND]: ReplyResultKinds.NOT_FOUND,
  [ApiErrorCodes.INVALID_REQUEST]: ReplyResultKinds.INVALID,
  [ApiErrorCodes.ATTACHMENT_UNSUPPORTED_TYPE]: ReplyResultKinds.INVALID,
  [ApiErrorCodes.NOT_A_PR_URL]: ReplyResultKinds.UPSTREAM,
  [ApiErrorCodes.SIGN_IN_FAILED]: ReplyResultKinds.UPSTREAM,
  [ApiErrorCodes.REQUEST_TOO_LARGE]: ReplyResultKinds.INVALID,
  [ApiErrorCodes.DIFF_TOO_LARGE]: ReplyResultKinds.UPSTREAM,
  // Read-only codes: this write transport cannot receive any of them.
  [ApiErrorCodes.FILE_NOT_FOUND]: ReplyResultKinds.UPSTREAM,
  [ApiErrorCodes.FILE_TOO_LARGE]: ReplyResultKinds.UPSTREAM,
  [ApiErrorCodes.FILE_NOT_TEXT]: ReplyResultKinds.UPSTREAM,
  [ApiErrorCodes.DRAFT_ALREADY_PUBLISHED]: ReplyResultKinds.UPSTREAM,
  [ApiErrorCodes.DRAFT_ANCHOR_ORPHANED]: ReplyResultKinds.UPSTREAM,
  [ApiErrorCodes.DRAFT_LIMIT_REACHED]: ReplyResultKinds.UPSTREAM,
  [ApiErrorCodes.SESSION_RECORD_LIMIT_REACHED]: ReplyResultKinds.UPSTREAM,
  [ApiErrorCodes.DRAFT_PUBLISH_PENDING]: ReplyResultKinds.UPSTREAM,
  [ApiErrorCodes.DRAFT_PUBLISH_IN_DOUBT]: ReplyResultKinds.UPSTREAM,
  [ApiErrorCodes.ATTACHMENT_LIMIT_REACHED]: ReplyResultKinds.UPSTREAM,
  [ApiErrorCodes.PENDING_REVIEW_HELD]: ReplyResultKinds.UPSTREAM,
  [ApiErrorCodes.PR_CHANGED_SINCE_READ]: ReplyResultKinds.UPSTREAM,
  [ApiErrorCodes.PR_REWRITTEN_SINCE_READ]: ReplyResultKinds.UPSTREAM,
  [ApiErrorCodes.GITHUB_UNAVAILABLE]: ReplyResultKinds.UPSTREAM,
  [ApiErrorCodes.ARTIFACT_UNREADABLE]: ReplyResultKinds.UPSTREAM,
  [ApiErrorCodes.INTERNAL_ERROR]: ReplyResultKinds.UPSTREAM,
  // Web-local; never on the wire: errorFromResponse cannot produce it.
  [ApiErrorCodes.MALFORMED]: ReplyResultKinds.UPSTREAM,
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
