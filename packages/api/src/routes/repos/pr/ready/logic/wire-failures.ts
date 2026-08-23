// The ready domain's failure->throw mapper (gated-route posture).
import { GitHubApiErrorCode } from "github";
import { ApiErrorCode } from "../../../../../error-response";
import {
  BadGateway,
  Forbidden,
  NotFound,
  Unauthorized,
} from "../../../../../shared-errors/api-error";
import type { MarkReadyFailure } from "../types";

/**
 * Map a GraphQL MUTATION-stage failure. This runs AFTER both the gate and
 * the fresh re-resolve succeeded — the viewer has already proven they can
 * see the repo, so there is no existence to leak by being specific. A
 * FORBIDDEN here is a genuine App permission gap:
 * `markPullRequestReadyForReview` requires the App to hold `contents: write`
 * (GitHub's own permission granularity — MergeBrief never pushes code), so
 * it surfaces as a distinct, honestly-actionable 403 instead of collapsing
 * into "no longer accessible". A NOT_FOUND still means the PR is genuinely
 * gone → 404.
 */
export function throwMarkReadyFailure(failure: MarkReadyFailure): never {
  if (failure.kind === "token-unreadable") {
    throw new Unauthorized(ApiErrorCode.UNAUTHORIZED);
  }
  if (failure.error.code === GitHubApiErrorCode.UNAUTHORIZED) {
    throw new Unauthorized(ApiErrorCode.UNAUTHORIZED);
  }
  if (failure.error.code === GitHubApiErrorCode.FORBIDDEN) {
    throw new Forbidden(ApiErrorCode.GITHUB_PERMISSION);
  }
  if (failure.error.code === GitHubApiErrorCode.NOT_FOUND) {
    throw new NotFound(ApiErrorCode.NOT_FOUND);
  }
  throw new BadGateway(ApiErrorCode.GITHUB_UNAVAILABLE);
}
