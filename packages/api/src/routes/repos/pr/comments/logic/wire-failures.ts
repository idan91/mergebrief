// The comments domain's failure->throw mappers: every GitHub refusal lands
// on the wire with the gated-route posture (uniform-404 collapse; distinct
// 409 only where the FE has a recovery action).
import { GitHubApiErrorCode, type InlineReviewCommentError } from "github";
import { ApiErrorCodes } from "../../../../../error-response";
import {
  BadGateway,
  Conflict,
  Forbidden,
  NotFound,
  Unauthorized,
} from "../../../../../shared-errors/api-error";
import type { PublishFailure, ReplyFailure, ResolutionFailure } from "../types";

/** Map a final create-comment failure to the sanitized response posture. */
export function throwPublishFailure(failure: PublishFailure): never {
  if (failure.kind === "token-unreadable") {
    throw new Unauthorized();
  }
  const error: InlineReviewCommentError = failure.error;
  // A 422 means the anchor no longer sits on the pinned commit's diff — the
  // head advanced under the composer. Fail with a distinct 409 so the FE
  // tells the author to reload (the draft survives locally), never a
  // retry-looking 502.
  if (error.staleAnchor === true) {
    throw new Conflict(ApiErrorCodes.PR_CHANGED_SINCE_READ);
  }
  if (error.code === GitHubApiErrorCode.UNAUTHORIZED) {
    throw new Unauthorized();
  }
  // 403/404 collapse to the gate's 404 posture — no existence leak.
  if (
    error.code === GitHubApiErrorCode.NOT_FOUND ||
    error.code === GitHubApiErrorCode.FORBIDDEN
  ) {
    throw new NotFound();
  }
  throw new BadGateway(ApiErrorCodes.GITHUB_UNAVAILABLE);
}

/**
 * Map a reply mutation failure. Gated-route rule: ANY in-route GitHub denial
 * (403/404) collapses to the gate's 404 posture — a root comment gone and a
 * permission denial must be indistinguishable from a cold denial.
 */
export function throwReplyFailure(failure: ReplyFailure): never {
  if (failure.kind === "token-unreadable") {
    throw new Unauthorized();
  }
  if (failure.error.code === GitHubApiErrorCode.UNAUTHORIZED) {
    throw new Unauthorized();
  }
  if (
    failure.error.code === GitHubApiErrorCode.NOT_FOUND ||
    failure.error.code === GitHubApiErrorCode.FORBIDDEN
  ) {
    throw new NotFound();
  }
  throw new BadGateway(ApiErrorCodes.GITHUB_UNAVAILABLE);
}

/**
 * Map a thread-flip MUTATION-stage failure: runs AFTER the gate and the
 * fresh re-resolve both succeeded, so there is no existence to hide.
 * FORBIDDEN is a genuine permission gap (read-only viewer / raced
 * revocation) → an honest, FE-actionable 403. NOT_FOUND covers the PR
 * vanishing AND a `commentId` matching no thread → 404.
 */
export function throwResolutionFailure(failure: ResolutionFailure): never {
  if (failure.kind === "token-unreadable") {
    throw new Unauthorized();
  }
  if (failure.error.code === GitHubApiErrorCode.UNAUTHORIZED) {
    throw new Unauthorized();
  }
  if (failure.error.code === GitHubApiErrorCode.FORBIDDEN) {
    throw new Forbidden(ApiErrorCodes.GITHUB_PERMISSION);
  }
  if (failure.error.code === GitHubApiErrorCode.NOT_FOUND) {
    throw new NotFound();
  }
  throw new BadGateway(ApiErrorCodes.GITHUB_UNAVAILABLE);
}
