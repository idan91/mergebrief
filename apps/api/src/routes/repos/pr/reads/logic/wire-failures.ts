// The reads domain's failure-to-throw mapping: a controller failure becomes
// the ApiError the handler throws, and nothing else decides posture.
import { ApiErrorCodes } from "contract";
import { GitHubApiErrorCodes } from "github";
import {
  BadGateway,
  BadRequest,
  NotFound,
  PayloadTooLarge,
  Unauthorized,
  type ApiError,
} from "../../../../../shared-errors/api-error";
import type { FileRangeFailure, StackFailure } from "../types";
import { FailureKinds } from "../../../../../shared-errors/failures";

/**
 * A GitHub denial collapses to the gate's bare 404, so a reader cannot tell a
 * repo they may not read from one that is not there. A path genuinely absent
 * at this commit is a DIFFERENT answer and keeps its own code, so the client
 * can say "reload the brief" rather than "you lost access". A 401 with the
 * request's single refresh spent and no retry is the re-login prompt; a
 * retried-still 401 is an upstream error like any other.
 */
export function toFileRangeError(failure: FileRangeFailure): ApiError {
  switch (failure.kind) {
    case FailureKinds.TOKEN_UNREADABLE: {
      return new Unauthorized();
    }
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
      return toDeniedError(failure.error.code, failure.retried);
    }
  }
}

export function toStackError(failure: StackFailure): ApiError {
  if (failure.kind === FailureKinds.TOKEN_UNREADABLE) {
    return new Unauthorized();
  }
  return toDeniedError(failure.error.code, failure.retried);
}

function toDeniedError(
  code: (typeof GitHubApiErrorCodes)[keyof typeof GitHubApiErrorCodes],
  retried: boolean,
): ApiError {
  if (code === GitHubApiErrorCodes.UNAUTHORIZED && !retried) {
    return new Unauthorized();
  }
  // Both denial codes collapse: this read carries no FE-actionable capability
  // signal, so an honest 403 would only say which repos the reader cannot see.
  if (
    code === GitHubApiErrorCodes.NOT_FOUND ||
    code === GitHubApiErrorCodes.FORBIDDEN
  ) {
    return new NotFound();
  }
  return new BadGateway(ApiErrorCodes.GITHUB_UNAVAILABLE);
}
