// The submit mutation over the isomorphic apiFetch boundary. Expected failure
// statuses are RESULT KINDS the flow renders — the fail-closed 409, the clean
// 401 re-login, and upstream rejections — never throws for those; only a
// malformed 2xx throws (contract violation).
import {
  ApiError,
  ApiErrorCode,
  apiFetch,
  errorFromResponse,
} from "../../../data/apiFetch";
import type {
  SubmitPayload,
  SubmitReviewResult,
} from "../../review/utils/submit";

export type { SubmitReviewResult } from "../../review/utils/submit";

type SubmitFailureKind = Exclude<SubmitReviewResult["kind"], "submitted">;

// Total over the wire vocabulary: a new ApiErrorCode member fails to compile
// here instead of silently becoming "try again shortly". Three 409s reach
// this route: the orphaned anchor is its own refusal; a frozen session
// (pr-changed) and a fail-closed unknown commit (pr-rewritten) both mean the
// read went stale — and pr-changed is what a codeless 409 synthesizes to. A
// 413 is deterministic (over-long body): edit, never retry-as-is.
const KIND_FOR_CODE = {
  [ApiErrorCode.UNAUTHORIZED]: "unauthorized",
  [ApiErrorCode.INVALID_SIGNATURE]: "upstream",
  [ApiErrorCode.FORBIDDEN]: "upstream",
  [ApiErrorCode.GITHUB_PERMISSION]: "upstream",
  [ApiErrorCode.SCOPE_EXCEEDED]: "upstream",
  [ApiErrorCode.HUMAN_ONLY]: "upstream",
  [ApiErrorCode.NO_REPO_WRITE_ACCESS]: "no-write-access",
  [ApiErrorCode.NOT_FOUND]: "not-found",
  [ApiErrorCode.INVALID_REQUEST]: "invalid",
  [ApiErrorCode.NOT_A_PR_URL]: "upstream",
  [ApiErrorCode.SIGN_IN_FAILED]: "upstream",
  [ApiErrorCode.REQUEST_TOO_LARGE]: "invalid",
  [ApiErrorCode.DIFF_TOO_LARGE]: "upstream",
  [ApiErrorCode.DRAFT_ALREADY_PUBLISHED]: "upstream",
  [ApiErrorCode.DRAFT_ANCHOR_ORPHANED]: "orphaned-draft",
  [ApiErrorCode.DRAFT_LIMIT_REACHED]: "upstream",
  [ApiErrorCode.PR_CHANGED_SINCE_READ]: "rewritten",
  [ApiErrorCode.PR_REWRITTEN_SINCE_READ]: "rewritten",
  [ApiErrorCode.APP_NOT_INSTALLED]: "upstream",
  [ApiErrorCode.GITHUB_UNAVAILABLE]: "upstream",
  [ApiErrorCode.GENERATION_FAILED]: "upstream",
  [ApiErrorCode.GENERATION_UNAVAILABLE]: "upstream",
  [ApiErrorCode.GENERATION_CONFIG]: "upstream",
  [ApiErrorCode.INTERNAL_ERROR]: "upstream",
  // Web-local; never on the wire — errorFromResponse cannot produce it.
  [ApiErrorCode.MALFORMED]: "upstream",
} as const satisfies Record<ApiErrorCode, SubmitFailureKind>;

interface SubmittedBody {
  reviewId: number;
  commentsDegraded: boolean;
}

function isSubmittedBody(value: unknown): value is SubmittedBody {
  return (
    typeof value === "object" &&
    value !== null &&
    "reviewId" in value &&
    typeof value.reviewId === "number" &&
    "commentsDegraded" in value &&
    typeof value.commentsDegraded === "boolean"
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
  if (!isSubmittedBody(body)) {
    throw new ApiError(ApiErrorCode.MALFORMED, response.status, path);
  }
  return {
    kind: "submitted",
    reviewId: body.reviewId,
    commentsDegraded: body.commentsDegraded,
  };
}
