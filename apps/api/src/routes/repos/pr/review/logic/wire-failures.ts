// The review domain's failure->throw mapper: domain codes first, every other
// GitHub refusal through the denial mapper under the honest write posture.
import { GitHubApiErrorCodes } from "github";
import { ApiErrorCodes } from "contract";
import { BadGateway, Conflict } from "../../../../../shared-errors/api-error";
import { FailureKinds } from "../../../../../shared-errors/failures";
import {
  resolveGitHubDenialError,
  unwrapGitHubFailure,
} from "../../../../../shared-errors/github-denial";
import { DenialPostures } from "../../../../../shared-errors/github-denial/types";
import type { ReviewPublishFailure } from "../../publish/types";

/**
 * An unknown commit means the PR was rewritten since it was read: fail
 * closed so the FE tells the reviewer to reload. Past the gate and the fresh
 * re-resolve, a FORBIDDEN is the viewer lacking permission to review.
 */
export function throwSubmitFailure(failure: ReviewPublishFailure): never {
  if (failure.kind === "pending-review-held") {
    throw new Conflict(ApiErrorCodes.PENDING_REVIEW_HELD);
  }
  if (failure.kind === "submit-unconfirmed") {
    throw new BadGateway(ApiErrorCodes.GITHUB_UNAVAILABLE);
  }
  if (failure.kind === "publish-expired") {
    throw new BadGateway(ApiErrorCodes.GITHUB_UNAVAILABLE);
  }
  const unknownCommit =
    failure.kind === FailureKinds.GITHUB_DENIED &&
    failure.error.code === GitHubApiErrorCodes.UNKNOWN_COMMIT;
  if (unknownCommit) {
    throw new Conflict(ApiErrorCodes.PR_REWRITTEN_SINCE_READ);
  }
  throw resolveGitHubDenialError(
    unwrapGitHubFailure(failure),
    DenialPostures.HONEST,
  );
}
