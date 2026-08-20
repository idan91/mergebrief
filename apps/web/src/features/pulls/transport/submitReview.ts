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
    // Three 409s reach here. The orphaned anchor is this route's own refusal;
    // a frozen session (pr-changed) and a fail-closed unknown commit
    // (pr-rewritten) both mean the read went stale, and pr-changed is what a
    // codeless 409 synthesizes to as well.
    if (code === ApiErrorCode.DRAFT_ANCHOR_ORPHANED) {
      return { kind: "orphaned-draft" };
    }
    if (
      code === ApiErrorCode.PR_REWRITTEN_SINCE_READ ||
      code === ApiErrorCode.PR_CHANGED_SINCE_READ
    ) {
      return { kind: "rewritten" };
    }
    if (code === ApiErrorCode.UNAUTHORIZED) return { kind: "unauthorized" };
    if (code === ApiErrorCode.NOT_FOUND) return { kind: "not-found" };
    if (code === ApiErrorCode.INVALID_REQUEST) return { kind: "invalid" };
    return { kind: "upstream" };
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
