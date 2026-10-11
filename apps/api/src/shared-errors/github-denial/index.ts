// The one place a GitHub failure becomes a wire status. A domain's
// `logic/wire-failures.ts` answers its own codes first and hands the rest
// here with the posture its call ran under.
import { ApiErrorCodes } from "contract";
import { CredentialFailureCodes, GitHubApiErrorCodes } from "github";
import {
  BadGateway,
  Forbidden,
  NotFound,
  Unauthorized,
  type ApiError,
} from "../api-error";
import { isTokenUnreadableFailure } from "../failures";
import {
  DenialPostures,
  type DenialPosture,
  type GitHubFailure,
  type WrappedGitHubFailure,
} from "./types";

function buildUnauthorized(): ApiError {
  return new Unauthorized();
}

function buildNotFound(): ApiError {
  return new NotFound();
}

function buildPermissionDenied(): ApiError {
  return new Forbidden(ApiErrorCodes.GITHUB_PERMISSION);
}

function buildUnavailable(): ApiError {
  return new BadGateway(ApiErrorCodes.GITHUB_UNAVAILABLE);
}

// A viewer 401 survives the request's refresh, so re-auth is the fix; the
// App's 401 is the instance's credential, which a sign-in cannot repair.
const UNAUTHORIZED_BY_POSTURE: Record<DenialPosture, () => ApiError> = {
  [DenialPostures.COLLAPSE]: buildUnauthorized,
  [DenialPostures.HONEST]: buildUnauthorized,
  [DenialPostures.APP_READ]: buildUnavailable,
  [DenialPostures.APP_WRITE]: buildUnavailable,
};

const FORBIDDEN_BY_POSTURE: Record<DenialPosture, () => ApiError> = {
  [DenialPostures.COLLAPSE]: buildNotFound,
  [DenialPostures.HONEST]: buildPermissionDenied,
  [DenialPostures.APP_READ]: buildNotFound,
  [DenialPostures.APP_WRITE]: buildPermissionDenied,
};

/** The GitHub failure a domain failure member carries. */
export function unwrapGitHubFailure(
  failure: WrappedGitHubFailure,
): GitHubFailure {
  if (isTokenUnreadableFailure(failure)) {
    return failure;
  }
  return failure.error;
}

/**
 * The `ApiError` a GitHub failure answers under `posture`; the caller throws
 * it. Absence is 404 everywhere; an outage, a rate limit and any code the
 * caller did not answer itself are 502, never 404.
 */
export function resolveGitHubDenialError(
  failure: GitHubFailure,
  posture: DenialPosture,
): ApiError {
  if (isTokenUnreadableFailure(failure)) {
    return new Unauthorized();
  }

  switch (failure.code) {
    case CredentialFailureCodes.CREDENTIAL_UNREADABLE: {
      return new Unauthorized();
    }
    case GitHubApiErrorCodes.UNAUTHORIZED: {
      return UNAUTHORIZED_BY_POSTURE[posture]();
    }
    case GitHubApiErrorCodes.FORBIDDEN: {
      return FORBIDDEN_BY_POSTURE[posture]();
    }
    case GitHubApiErrorCodes.NOT_FOUND: {
      return new NotFound();
    }
    default: {
      return buildUnavailable();
    }
  }
}
