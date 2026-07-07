// The submit mutation over the isomorphic apiFetch seam (BRIEF-23 PR 3).
// Client-only in practice (a user click), but it rides the same seam as the
// reads. Expected failure statuses are RESULT KINDS the flow renders — the
// fail-closed 409 ("PR was rewritten — reload"), the clean 401 re-login, and
// upstream rejections — never throws for those; only a malformed 2xx throws
// (contract violation).
import { ApiError, ApiErrorKind, apiFetch } from "../../data/apiFetch";
import type { SubmitPayload, SubmitReviewResult } from "../review/submit";

export type { SubmitReviewResult } from "../review/submit";

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
  payload: SubmitPayload,
): Promise<SubmitReviewResult> {
  const path = `/api/repos/${encodeURIComponent(repoId)}/pulls/${String(prNumber)}/review`;
  const response = await apiFetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (response.status === 409) {
    return { kind: "rewritten" };
  }
  if (response.status === 401) {
    return { kind: "unauthorized" };
  }
  if (response.status === 404) {
    return { kind: "not-found" };
  }
  if (response.status === 400) {
    return { kind: "invalid" };
  }
  if (!response.ok) {
    return { kind: "upstream" };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ApiError(ApiErrorKind.MALFORMED, response.status, path);
  }
  if (!isSubmittedBody(body)) {
    throw new ApiError(ApiErrorKind.MALFORMED, response.status, path);
  }
  return {
    kind: "submitted",
    reviewId: body.reviewId,
    commentsDegraded: body.commentsDegraded,
  };
}
