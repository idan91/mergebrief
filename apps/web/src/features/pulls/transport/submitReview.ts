// The submit mutation over the isomorphic apiFetch boundary. Expected failure
// statuses are RESULT KINDS the flow renders, the fail-closed 409, the clean
// 401 re-login, and upstream rejections, never throws for those; only a
// malformed 2xx throws (contract violation).
import {
  ApiError,
  ApiErrorCodes,
  apiFetch,
  errorFromResponse,
  type ApiErrorCode,
} from "../../../data/apiFetch";
import {
  SubmitReviewResultKinds,
  type SubmitPayload,
  type SubmitReviewResult,
  type SubmitReviewResultKind,
} from "@web/features/review/utils";

type SubmitFailureKind = Exclude<
  SubmitReviewResultKind,
  typeof SubmitReviewResultKinds.SUBMITTED
>;

// The web proxy answers 504 when its upstream budget runs out; the API keeps
// posting threads and may still submit, so a retry here would post twice.
const PROXY_TIMEOUT_STATUS = 504;

// Total over the wire vocabulary: a new ApiErrorCode member fails to compile
// here instead of silently becoming "try again shortly". Three 409s reach
// this route: the orphaned anchor is its own refusal; a frozen session
// (pr-changed) and a fail-closed unknown commit (pr-rewritten) both mean the
// read went stale, and pr-changed is what a codeless 409 synthesizes to. A
// 413 is deterministic (over-long body): edit, never retry-as-is.
const KindForCode = {
  [ApiErrorCodes.UNAUTHORIZED]: SubmitReviewResultKinds.UNAUTHORIZED,
  [ApiErrorCodes.INVALID_SIGNATURE]: SubmitReviewResultKinds.UPSTREAM,
  [ApiErrorCodes.FORBIDDEN]: SubmitReviewResultKinds.UPSTREAM,
  [ApiErrorCodes.GITHUB_PERMISSION]: SubmitReviewResultKinds.GITHUB_PERMISSION,
  [ApiErrorCodes.SCOPE_EXCEEDED]: SubmitReviewResultKinds.UPSTREAM,
  [ApiErrorCodes.HUMAN_ONLY]: SubmitReviewResultKinds.UPSTREAM,
  [ApiErrorCodes.NO_REPO_WRITE_ACCESS]: SubmitReviewResultKinds.NO_WRITE_ACCESS,
  [ApiErrorCodes.REPO_ADMIN_ONLY]: SubmitReviewResultKinds.UPSTREAM,
  [ApiErrorCodes.ATTACHMENTS_DISABLED]: SubmitReviewResultKinds.UPSTREAM,
  [ApiErrorCodes.ATTACHMENTS_ADMIN_ONLY]: SubmitReviewResultKinds.UPSTREAM,
  [ApiErrorCodes.NOT_FOUND]: SubmitReviewResultKinds.NOT_FOUND,
  [ApiErrorCodes.INVALID_REQUEST]: SubmitReviewResultKinds.INVALID,
  [ApiErrorCodes.ATTACHMENT_UNSUPPORTED_TYPE]: SubmitReviewResultKinds.INVALID,
  [ApiErrorCodes.NOT_A_PR_URL]: SubmitReviewResultKinds.UPSTREAM,
  [ApiErrorCodes.SIGN_IN_FAILED]: SubmitReviewResultKinds.UPSTREAM,
  [ApiErrorCodes.REQUEST_TOO_LARGE]: SubmitReviewResultKinds.INVALID,
  [ApiErrorCodes.DIFF_TOO_LARGE]: SubmitReviewResultKinds.UPSTREAM,
  // Read-only codes: this write transport cannot receive any of them.
  [ApiErrorCodes.FILE_NOT_FOUND]: SubmitReviewResultKinds.UPSTREAM,
  [ApiErrorCodes.FILE_TOO_LARGE]: SubmitReviewResultKinds.UPSTREAM,
  [ApiErrorCodes.FILE_NOT_TEXT]: SubmitReviewResultKinds.UPSTREAM,
  [ApiErrorCodes.DRAFT_ALREADY_PUBLISHED]: SubmitReviewResultKinds.UPSTREAM,
  [ApiErrorCodes.DRAFT_ANCHOR_ORPHANED]: SubmitReviewResultKinds.ORPHANED_DRAFT,
  [ApiErrorCodes.DRAFT_LIMIT_REACHED]: SubmitReviewResultKinds.UPSTREAM,
  [ApiErrorCodes.SESSION_RECORD_LIMIT_REACHED]:
    SubmitReviewResultKinds.UPSTREAM,
  [ApiErrorCodes.DRAFT_PUBLISH_PENDING]:
    SubmitReviewResultKinds.PUBLISH_PENDING,
  [ApiErrorCodes.DRAFT_PUBLISH_IN_DOUBT]:
    SubmitReviewResultKinds.PUBLISH_IN_DOUBT,
  [ApiErrorCodes.ATTACHMENT_LIMIT_REACHED]: SubmitReviewResultKinds.UPSTREAM,
  [ApiErrorCodes.PENDING_REVIEW_HELD]:
    SubmitReviewResultKinds.PENDING_REVIEW_HELD,
  [ApiErrorCodes.PR_CHANGED_SINCE_READ]: SubmitReviewResultKinds.REWRITTEN,
  [ApiErrorCodes.PR_REWRITTEN_SINCE_READ]: SubmitReviewResultKinds.REWRITTEN,
  [ApiErrorCodes.APP_NOT_INSTALLED]: SubmitReviewResultKinds.UPSTREAM,
  [ApiErrorCodes.GITHUB_UNAVAILABLE]: SubmitReviewResultKinds.UPSTREAM,
  [ApiErrorCodes.GENERATION_FAILED]: SubmitReviewResultKinds.UPSTREAM,
  [ApiErrorCodes.GENERATION_UNAVAILABLE]: SubmitReviewResultKinds.UPSTREAM,
  [ApiErrorCodes.GENERATION_CONFIG]: SubmitReviewResultKinds.UPSTREAM,
  [ApiErrorCodes.INTERNAL_ERROR]: SubmitReviewResultKinds.UPSTREAM,
  // Web-local; never on the wire, errorFromResponse cannot produce it.
  [ApiErrorCodes.MALFORMED]: SubmitReviewResultKinds.UPSTREAM,
} as const satisfies Record<ApiErrorCode, SubmitFailureKind>;

interface SubmittedBody {
  reviewId: number;
  commentsFolded: number;
  commentsTotal: number;
}

function isSubmittedBody(value: unknown): value is SubmittedBody {
  return (
    typeof value === "object" &&
    value !== null &&
    "reviewId" in value &&
    typeof value.reviewId === "number" &&
    "commentsFolded" in value &&
    typeof value.commentsFolded === "number" &&
    "commentsTotal" in value &&
    typeof value.commentsTotal === "number"
  );
}

export async function submitReview(
  repoId: string,
  prNumber: number,
  span: { base: string; head: string },
  payload: SubmitPayload,
): Promise<SubmitReviewResult> {
  // The write NAMES its Brief, exactly as the session read did: resolving
  // "the newest Brief" would submit a stale tab against a revision it has
  // never seen.
  const query = `base=${encodeURIComponent(span.base)}&head=${encodeURIComponent(span.head)}`;
  const path = `/api/repos/${encodeURIComponent(repoId)}/pulls/${String(prNumber)}/review?${query}`;
  const response = await apiFetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (response.status === PROXY_TIMEOUT_STATUS) {
    return { kind: SubmitReviewResultKinds.INDETERMINATE };
  }
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
  if (!isSubmittedBody(body)) {
    throw new ApiError(ApiErrorCodes.MALFORMED, response.status, path);
  }
  return {
    kind: SubmitReviewResultKinds.SUBMITTED,
    reviewId: body.reviewId,
    commentsFolded: body.commentsFolded,
    commentsTotal: body.commentsTotal,
  };
}
