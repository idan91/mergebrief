// The single sanitization chokepoint for GitHub REST failures (BRIEF-2 stage
// 2). Every API-call wrapper (comments, repo, pull-request) funnels a thrown
// error through `mapRequestError` so that NO auth header, token, request URL,
// or raw response body ever reaches a `Result` error — only an HTTP status and
// a static, caller-supplied context string. `RequestError` is octokit's own
// error class (re-exported from the umbrella package); it carries `.status`,
// `.request`, and `.response`, none of which we surface.
import { RequestError } from "octokit";
import type { ValueOf } from "./types";

export const GitHubApiErrorCode = {
  NOT_FOUND: "not-found",
  FORBIDDEN: "forbidden",
  UNAUTHORIZED: "unauthorized",
  RATE_LIMITED: "rate-limited",
  REQUEST_FAILED: "request-failed",
} as const;
export type GitHubApiErrorCode = ValueOf<typeof GitHubApiErrorCode>;

export interface GitHubApiError {
  readonly code: GitHubApiErrorCode;
  /** HTTP status, when the failure was an HTTP response (absent for network/transport errors). */
  readonly status?: number;
  /**
   * A sanitized, human-readable summary. Derived only from the HTTP status and
   * a static context label — never the upstream message, response body, or any
   * request header (which may carry the installation token).
   */
  readonly message: string;
}

function codeForStatus(status: number): GitHubApiErrorCode {
  switch (status) {
    case 401: {
      return GitHubApiErrorCode.UNAUTHORIZED;
    }
    case 403: {
      return GitHubApiErrorCode.FORBIDDEN;
    }
    case 404: {
      return GitHubApiErrorCode.NOT_FOUND;
    }
    case 429: {
      return GitHubApiErrorCode.RATE_LIMITED;
    }
    default: {
      return GitHubApiErrorCode.REQUEST_FAILED;
    }
  }
}

/**
 * Map any thrown value from an octokit request into a sanitized
 * `GitHubApiError`. `context` is a STATIC verb phrase supplied by the caller
 * (e.g. `"post entry comment"`) — never interpolated from user/GitHub input —
 * so the resulting message carries no untrusted or secret bytes.
 */
export function mapRequestError(error: unknown, context: string): GitHubApiError {
  if (error instanceof RequestError) {
    return {
      code: codeForStatus(error.status),
      status: error.status,
      message: `failed to ${context}: GitHub API returned status ${error.status}`,
    };
  }
  return {
    code: GitHubApiErrorCode.REQUEST_FAILED,
    message: `failed to ${context}: GitHub API request did not complete`,
  };
}

/** Build a sanitized `GitHubApiError` for an unexpected/ill-shaped 2xx response body. */
export function unexpectedResponseError(context: string): GitHubApiError {
  return {
    code: GitHubApiErrorCode.REQUEST_FAILED,
    message: `failed to ${context}: unexpected GitHub API response shape`,
  };
}
