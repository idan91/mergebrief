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
import type {
  SubmitPayload,
  SubmitReviewResult,
} from "@web/features/review/utils";

type SubmitFailureKind = Exclude<SubmitReviewResult["kind"], "submitted">;

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
  [ApiErrorCodes.DRAFT_ANCHOR_ORPHANED]: "orphaned-draft",
  [ApiErrorCodes.DRAFT_LIMIT_REACHED]: "upstream",
  [ApiErrorCodes.SESSION_RECORD_LIMIT_REACHED]: "upstream",
  [ApiErrorCodes.DRAFT_PUBLISH_PENDING]: "upstream",
  [ApiErrorCodes.DRAFT_PUBLISH_IN_DOUBT]: "upstream",
  [ApiErrorCodes.ATTACHMENT_LIMIT_REACHED]: "upstream",
  [ApiErrorCodes.PENDING_REVIEW_HELD]: "pending-review-held",
  [ApiErrorCodes.PR_CHANGED_SINCE_READ]: "rewritten",
  [ApiErrorCodes.PR_REWRITTEN_SINCE_READ]: "rewritten",
  [ApiErrorCodes.APP_NOT_INSTALLED]: "upstream",
  [ApiErrorCodes.GITHUB_UNAVAILABLE]: "upstream",
  [ApiErrorCodes.GENERATION_FAILED]: "upstream",
  [ApiErrorCodes.GENERATION_UNAVAILABLE]: "upstream",
  [ApiErrorCodes.GENERATION_CONFIG]: "upstream",
  [ApiErrorCodes.INTERNAL_ERROR]: "upstream",
  // Web-local; never on the wire, errorFromResponse cannot produce it.
  [ApiErrorCodes.MALFORMED]: "upstream",
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
    return { kind: "indeterminate" };
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
    kind: "submitted",
    reviewId: body.reviewId,
    commentsFolded: body.commentsFolded,
    commentsTotal: body.commentsTotal,
  };
}
