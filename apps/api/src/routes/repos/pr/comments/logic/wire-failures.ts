// The comments domain's failure->throw mappers: domain codes first, every
// other GitHub refusal through the denial mapper under the write's posture.
import { GitHubApiErrorCodes } from "github";
import { ApiErrorCodes } from "contract";
import { Conflict } from "../../../../../shared-errors/api-error";
import { FailureKinds } from "../../../../../shared-errors/failures";
import {
  resolveGitHubDenialError,
  unwrapGitHubFailure,
} from "../../../../../shared-errors/github-denial";
import { DenialPostures } from "../../../../../shared-errors/github-denial/types";
import type { ReplyFailure, ResolutionFailure } from "../types";
import type { CommentPublishFailure } from "../../publish/types";

/**
 * A 422 means the anchor no longer sits on the pinned commit's diff: a
 * distinct 409 so the FE tells the author to reload, never a retry-looking
 * 502. A 403 is the viewer lacking permission to comment, as on a submit.
 */
export function throwPublishFailure(failure: CommentPublishFailure): never {
  const anchorRejected =
    failure.kind === FailureKinds.GITHUB_DENIED &&
    failure.error.code === GitHubApiErrorCodes.ANCHOR_REJECTED;
  if (anchorRejected) {
    throw new Conflict(ApiErrorCodes.PR_CHANGED_SINCE_READ);
  }
  throw resolveGitHubDenialError(
    unwrapGitHubFailure(failure),
    DenialPostures.HONEST,
  );
}

/**
 * A root comment gone and a permission denial must be indistinguishable from
 * a cold gate denial: a reply's 403 carries no capability signal.
 */
export function throwReplyFailure(failure: ReplyFailure): never {
  throw resolveGitHubDenialError(
    unwrapGitHubFailure(failure),
    DenialPostures.COLLAPSE,
  );
}

/**
 * Runs after the gate and the fresh re-resolve, so a FORBIDDEN is a genuine
 * permission gap; NOT_FOUND covers a `commentId` matching no thread too.
 */
export function throwResolutionFailure(failure: ResolutionFailure): never {
  throw resolveGitHubDenialError(
    unwrapGitHubFailure(failure),
    DenialPostures.HONEST,
  );
}
