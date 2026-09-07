// The ready domain's failure->throw mapper (gated-route posture).
import { GitHubApiErrorCodes } from "github";
import { ApiErrorCodes } from "../../../../../error-response";
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
