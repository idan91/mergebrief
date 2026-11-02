// The reads domain's failure-to-throw mapping: an operation failure becomes
// the ApiError the adapter throws, and nothing else decides posture.
import { ApiErrorCodes } from "contract";
import { GitHubApiErrorCodes, isNotAcceptable } from "github";
import {
  BadRequest,
  GatewayTimeout,
  NotFound,
  PayloadTooLarge,
  type ApiError,
} from "../../../../../shared-errors/api-error";
import { resolveGitHubDenialError } from "../../../../../shared-errors/github-denial";
import { DenialPostures } from "../../../../../shared-errors/github-denial/types";
import type { DiffFailure, FileRangeFailure, StackFailure } from "../types";

/** Every live read runs on the viewer's credential: a refusal reads as absence. */
function resolveLiveReadError(failure: DiffFailure): ApiError {
  if (failure.kind === "not-found") {
    return new NotFound();
  }
  return resolveGitHubDenialError(failure.error, DenialPostures.COLLAPSE);
}

/**
 * GitHub's 406 refuses to render a diff over its size limits, permanent for
 * this span, so it answers 413 rather than a retryable-looking 502. A render
 * GitHub did not finish inside the read's deadline answers 504.
 */
export function resolveDiffError(failure: DiffFailure): ApiError {
  if (failure.kind === "not-found") {
    return new NotFound();
  }
  if (isNotAcceptable(failure.error)) {
    return new PayloadTooLarge(ApiErrorCodes.DIFF_TOO_LARGE);
  }
  if (failure.error.code === GitHubApiErrorCodes.DIFF_TIMED_OUT) {
    return new GatewayTimeout(ApiErrorCodes.DIFF_FETCH_TIMEOUT);
  }
  return resolveLiveReadError(failure);
}

/**
 * A path genuinely absent at this commit keeps its own code apart from the
 * collapsed denial, so the client can say "reload the brief" rather than
 * "you lost access".
 */
export function resolveFileRangeError(failure: FileRangeFailure): ApiError {
  switch (failure.kind) {
    case "file-absent": {
      return new NotFound(ApiErrorCodes.FILE_NOT_FOUND);
    }
    case "file-too-large": {
      return new PayloadTooLarge(ApiErrorCodes.FILE_TOO_LARGE);
    }
    case "file-not-text": {
      return new BadRequest(ApiErrorCodes.FILE_NOT_TEXT);
    }
    default: {
      return resolveLiveReadError(failure);
    }
  }
}

export function resolveStackError(failure: StackFailure): ApiError {
  return resolveLiveReadError(failure);
}
