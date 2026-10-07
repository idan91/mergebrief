// The review domain's failure->throw mapper (gated-route posture).
import {
  GitHubApiErrorCodes,
  ReviewValidationClasses,
  type CreateReviewError,
  type ReviewValidationClass,
} from "github";
import { ApiErrorCodes } from "contract";
import {
  BadGateway,
  Conflict,
  Forbidden,
  NotFound,
  Unauthorized,
} from "../../../../../shared-errors/api-error";
import type { ReviewPublishFailure } from "../../publish/types";
import { FailureKinds } from "../../../../../shared-errors/failures";

function isValidation(
  error: CreateReviewError,
  kind: ReviewValidationClass,
): boolean {
  return error.validation === kind;
}

/** Map a final create-review failure to the sanitized response posture. */
export function throwSubmitFailure(failure: ReviewPublishFailure): never {
  if (failure.kind === FailureKinds.TOKEN_UNREADABLE) {
    throw new Unauthorized();
  }
  if (failure.kind === "pending-review-held") {
    throw new Conflict(ApiErrorCodes.PENDING_REVIEW_HELD);
  }
  if (failure.kind === "submit-unconfirmed") {
    throw new BadGateway(ApiErrorCodes.GITHUB_UNAVAILABLE);
  }
  if (failure.kind === "publish-expired") {
    throw new BadGateway(ApiErrorCodes.GITHUB_UNAVAILABLE);
  }
  const error = failure.error;
  // Unknown commit → the PR was rewritten since it was read. Fail closed;
  // the FE tells the reviewer to reload (drafts survive via sessionStorage).
  if (isValidation(error, ReviewValidationClasses.UNKNOWN_COMMIT)) {
    throw new Conflict(ApiErrorCodes.PR_REWRITTEN_SINCE_READ);
  }
  // A still-unauthorized final result (refresh budget spent or hard-failed)
  // is a clean re-login prompt, not an upstream error.
  if (error.code === GitHubApiErrorCodes.UNAUTHORIZED) {
    throw new Unauthorized();
  }
  // Past the gate and the fresh re-resolve there is no existence to hide: a
  // FORBIDDEN is the viewer lacking permission to review, which they can act on.
  if (error.code === GitHubApiErrorCodes.FORBIDDEN) {
    throw new Forbidden(ApiErrorCodes.GITHUB_PERMISSION);
  }
  if (error.code === GitHubApiErrorCodes.NOT_FOUND) {
    throw new NotFound();
  }
  throw new BadGateway(ApiErrorCodes.GITHUB_UNAVAILABLE);
}
