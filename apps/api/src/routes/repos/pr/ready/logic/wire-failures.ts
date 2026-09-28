// The ready domain's failure->throw mapper (gated-route posture).
import { GitHubApiErrorCodes } from "github";
import { ApiErrorCodes } from "contract";
import {
  BadGateway,
  Forbidden,
  NotFound,
  Unauthorized,
} from "../../../../../shared-errors/api-error";
import type { MarkReadyFailure } from "../types";
import { FailureKinds } from "../../../../../shared-errors/failures";

/**
 * Map a GraphQL MUTATION-stage failure. This runs AFTER both the gate and the
 * fresh re-resolve succeeded, so the viewer has already proven repo access
 * and there is no existence to leak by being specific. A FORBIDDEN here is a
 * genuine App permission gap: `markPullRequestReadyForReview` requires
 * `contents: write`, GitHub's own granularity, so it surfaces as an honestly
 * actionable 403 rather than collapsing into "no longer accessible". A
 * NOT_FOUND still means the PR is genuinely gone.
 */
export function throwMarkReadyFailure(failure: MarkReadyFailure): never {
  if (failure.kind === FailureKinds.TOKEN_UNREADABLE) {
    throw new Unauthorized();
  }
  if (failure.error.code === GitHubApiErrorCodes.UNAUTHORIZED) {
    throw new Unauthorized();
  }
  if (failure.error.code === GitHubApiErrorCodes.FORBIDDEN) {
    throw new Forbidden(ApiErrorCodes.GITHUB_PERMISSION);
  }
  if (failure.error.code === GitHubApiErrorCodes.NOT_FOUND) {
    throw new NotFound();
  }
  throw new BadGateway(ApiErrorCodes.GITHUB_UNAVAILABLE);
}
