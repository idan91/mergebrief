// The comments domain's failure->throw mappers: every GitHub refusal lands
// on the wire with the gated-route posture (uniform-404 collapse; distinct
// 409 only where the FE has a recovery action).
import { GitHubApiErrorCode, type InlineReviewCommentError } from "github";
import { ApiErrorCode } from "../../../../../error-response";
import {
  BadGateway,
  Conflict,
  NotFound,
  Unauthorized,
} from "../../../../../shared-errors/api-error";
import type {
  PublishFailure,
  RepoResolveFailure,
  ReplyFailure,
} from "../types";

/**
 * Map a resolve-phase failure (not a write yet — BEFORE the viewer has
 * re-proven access this request): 403/404 both collapse to the gate's 404
 * posture; a still-unauthorized answer is a clean re-login 401.
 */
export function throwRepoResolveFailure(failure: RepoResolveFailure): never {
  if (failure.kind === "token-unreadable") {
    throw new Unauthorized(ApiErrorCode.UNAUTHORIZED);
  }
  if (failure.error.code === GitHubApiErrorCode.UNAUTHORIZED) {
    throw new Unauthorized(ApiErrorCode.UNAUTHORIZED);
  }
  if (
    failure.error.code === GitHubApiErrorCode.NOT_FOUND ||
    failure.error.code === GitHubApiErrorCode.FORBIDDEN
  ) {
    throw new NotFound(ApiErrorCode.NOT_FOUND);
  }
  throw new BadGateway(ApiErrorCode.GITHUB_UNAVAILABLE);
}

/** Map a final create-comment failure to the sanitized response posture. */
export function throwPublishFailure(failure: PublishFailure): never {
  if (failure.kind === "token-unreadable") {
    throw new Unauthorized(ApiErrorCode.UNAUTHORIZED);
  }
  const error: InlineReviewCommentError = failure.error;
  // A 422 means the anchor no longer sits on the pinned commit's diff — the
  // head advanced under the composer. Fail with a distinct 409 so the FE
  // tells the author to reload (the draft survives locally), never a
  // retry-looking 502.
  if (error.staleAnchor === true) {
    throw new Conflict(ApiErrorCode.PR_CHANGED_SINCE_READ);
  }
  if (error.code === GitHubApiErrorCode.UNAUTHORIZED) {
    throw new Unauthorized(ApiErrorCode.UNAUTHORIZED);
  }
  // 403/404 collapse to the gate's 404 posture — no existence leak.
  if (
    error.code === GitHubApiErrorCode.NOT_FOUND ||
    error.code === GitHubApiErrorCode.FORBIDDEN
  ) {
    throw new NotFound(ApiErrorCode.NOT_FOUND);
  }
  throw new BadGateway(ApiErrorCode.GITHUB_UNAVAILABLE);
}

/**
 * Map a reply mutation failure. Gated-route rule: ANY in-route GitHub denial
 * (403/404) collapses to the gate's 404 posture — a root comment gone and a
 * permission denial must be indistinguishable from a cold denial.
 */
export function throwReplyFailure(failure: ReplyFailure): never {
  if (failure.kind === "token-unreadable") {
    throw new Unauthorized(ApiErrorCode.UNAUTHORIZED);
  }
  if (failure.error.code === GitHubApiErrorCode.UNAUTHORIZED) {
    throw new Unauthorized(ApiErrorCode.UNAUTHORIZED);
  }
  if (
    failure.error.code === GitHubApiErrorCode.NOT_FOUND ||
    failure.error.code === GitHubApiErrorCode.FORBIDDEN
  ) {
    throw new NotFound(ApiErrorCode.NOT_FOUND);
  }
  throw new BadGateway(ApiErrorCode.GITHUB_UNAVAILABLE);
}
