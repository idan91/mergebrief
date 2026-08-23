// The review domain's failure->throw mapper (gated-route posture).
import {
  GitHubApiErrorCode,
  ReviewValidationClass,
  type CreateReviewError,
} from "github";
import { ApiErrorCodes } from "../../../../../error-response";
import {
  BadGateway,
  Conflict,
  NotFound,
  Unauthorized,
} from "../../../../../shared-errors/api-error";
import type { SubmitFailure } from "../types";

function isValidation(
  error: CreateReviewError,
  kind: ReviewValidationClass,
): boolean {
  return error.validation === kind;
}

/** Map a final create-review failure to the sanitized response posture. */
export function throwSubmitFailure(failure: SubmitFailure): never {
  if (failure.kind === "token-unreadable") {
    throw new Unauthorized();
  }
  const error = failure.error;
  // Unknown commit → the PR was rewritten since it was read. Fail closed;
  // the FE tells the reviewer to reload (drafts survive via sessionStorage).
  if (isValidation(error, ReviewValidationClass.UNKNOWN_COMMIT)) {
    throw new Conflict(ApiErrorCodes.PR_REWRITTEN_SINCE_READ);
  }
  // A still-unauthorized final result (refresh budget spent or hard-failed)
  // is a clean re-login prompt, not an upstream error.
  if (error.code === GitHubApiErrorCode.UNAUTHORIZED) {
    throw new Unauthorized();
  }
  if (error.code === GitHubApiErrorCode.NOT_FOUND) {
    throw new NotFound();
  }
  throw new BadGateway(ApiErrorCodes.GITHUB_UNAVAILABLE);
}
