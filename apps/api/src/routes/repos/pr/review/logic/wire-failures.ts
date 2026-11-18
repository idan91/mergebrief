// The review domain's failure->throw mapper: the session's and the domain's
// own codes first, the fresh re-resolve as the gate would answer it, every
// other GitHub refusal through the denial mapper under the honest posture.
import { ApiErrorCodes } from "contract";
import { GitHubApiErrorCodes, type GitHubCallFailure } from "github";
import type { AccessFooting } from "../../../../../access/types";
import {
  BadGateway,
  BadRequest,
  Conflict,
  type ApiError,
} from "../../../../../shared-errors/api-error";
import {
  FailureKinds,
  type GitHubDeniedFailure,
} from "../../../../../shared-errors/failures";
import { resolveGitHubDenialError } from "../../../../../shared-errors/github-denial";
import { DenialPostures } from "../../../../../shared-errors/github-denial/types";
import { resolveFreshRepositoryError } from "../../../logic/fresh-repository";
import { throwSessionWriteFailure } from "../../session/logic/wire-failures";
import type { SubmitReviewFailure } from "../types";

/**
 * An unknown commit means the PR was rewritten since it was read: fail
 * closed so the FE tells the reviewer to reload. Past the gate and the fresh
 * re-resolve, a FORBIDDEN is the viewer lacking permission to review.
 */
function resolveReviewDeniedError(
  failure: GitHubDeniedFailure<GitHubCallFailure>,
  footing: AccessFooting,
): ApiError {
  if (failure.phase === "resolve") {
    return resolveFreshRepositoryError(failure.error, footing);
  }
  if (failure.error.code === GitHubApiErrorCodes.UNKNOWN_COMMIT) {
    return new Conflict(ApiErrorCodes.PR_REWRITTEN_SINCE_READ);
  }
  return resolveGitHubDenialError(failure.error, DenialPostures.HONEST);
}

export function throwSubmitFailure(
  failure: SubmitReviewFailure,
  footing: AccessFooting,
): never {
  if (failure.kind === FailureKinds.SESSION_REJECTED) {
    throwSessionWriteFailure(failure);
  }
  if (failure.kind === FailureKinds.GITHUB_DENIED) {
    throw resolveReviewDeniedError(failure, footing);
  }
  if (failure.kind === "draft-anchor-orphaned") {
    throw new Conflict(ApiErrorCodes.DRAFT_ANCHOR_ORPHANED);
  }
  if (failure.kind === "submit-invalid") {
    throw new BadRequest();
  }
  if (failure.kind === "pending-review-held") {
    throw new Conflict(ApiErrorCodes.PENDING_REVIEW_HELD);
  }
  throw new BadGateway(ApiErrorCodes.GITHUB_UNAVAILABLE);
}
