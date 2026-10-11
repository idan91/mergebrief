// The comments domain's failure->throw mappers: domain codes first, the
// fresh re-resolve as the gate would answer it, every other GitHub refusal
// through the denial mapper under the write's posture.
import { ApiErrorCodes } from "contract";
import { GitHubApiErrorCodes } from "github";
import type { AccessFooting } from "../../../../../access/types";
import {
  BadGateway,
  Conflict,
  type ApiError,
} from "../../../../../shared-errors/api-error";
import { FailureKinds } from "../../../../../shared-errors/failures";
import { resolveGitHubDenialError } from "../../../../../shared-errors/github-denial";
import {
  DenialPostures,
  type DenialPosture,
} from "../../../../../shared-errors/github-denial/types";
import { resolveFreshRepositoryError } from "../../../logic/fresh-repository";
import { throwSessionWriteFailure } from "../../session/logic/write-seam";
import type { CommentDeniedFailure, PostNowFailure } from "../types";

function resolveCommentDeniedError(
  failure: CommentDeniedFailure,
  footing: AccessFooting,
  posture: DenialPosture,
): ApiError {
  if (failure.phase === "resolve") {
    return resolveFreshRepositoryError(failure.error, footing);
  }
  return resolveGitHubDenialError(failure.error, posture);
}

/**
 * A 422 means the anchor no longer sits on the pinned commit's diff: a
 * distinct 409 so the FE tells the author to reload, never a retry-looking
 * 502. A 403 is the viewer lacking permission to comment, as on a submit.
 * Every in-doubt answer keeps the claim, and the reviewer decides.
 */
export function throwPostNowFailure(
  failure: PostNowFailure,
  footing: AccessFooting,
): never {
  if (failure.kind === FailureKinds.SESSION_REJECTED) {
    throwSessionWriteFailure(failure);
  }
  if (failure.kind === "publish-in-doubt") {
    throw new Conflict(ApiErrorCodes.DRAFT_PUBLISH_IN_DOUBT);
  }
  if (failure.kind === "sibling-published") {
    throw new Conflict(ApiErrorCodes.DRAFT_ALREADY_PUBLISHED);
  }
  if (failure.kind === "publish-expired") {
    throw new BadGateway(ApiErrorCodes.GITHUB_UNAVAILABLE);
  }
  if (failure.error.code === GitHubApiErrorCodes.ANCHOR_REJECTED) {
    throw new Conflict(ApiErrorCodes.PR_CHANGED_SINCE_READ);
  }
  throw resolveCommentDeniedError(failure, footing, DenialPostures.HONEST);
}

/**
 * A root comment gone and a permission denial must be indistinguishable from
 * a cold gate denial: a reply's 403 carries no capability signal.
 */
export function throwReplyFailure(
  failure: CommentDeniedFailure,
  footing: AccessFooting,
): never {
  throw resolveCommentDeniedError(failure, footing, DenialPostures.COLLAPSE);
}

/**
 * Runs after the gate and the fresh re-resolve, so a FORBIDDEN is a genuine
 * permission gap; NOT_FOUND covers a `commentId` matching no thread too.
 */
export function throwResolutionFailure(
  failure: CommentDeniedFailure,
  footing: AccessFooting,
): never {
  throw resolveCommentDeniedError(failure, footing, DenialPostures.HONEST);
}
