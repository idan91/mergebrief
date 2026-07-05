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

/**
 * GitHub signals throttling with a 403 (NOT 429) plus rate-limit headers:
 * `x-ratelimit-remaining: 0` for the primary limit, or a `retry-after` header
 * for a secondary/abuse limit. Reading these headers (never the body) lets us
 * classify throttling distinctly from a genuine permission denial without
 * leaking any secret — the sanitized message still carries only the status.
 */
function isRateLimited403(error: RequestError): boolean {
  const headers = error.response?.headers;
  if (headers === undefined) {
    return false;
  }
  if (headers["x-ratelimit-remaining"] === "0") {
    return true;
  }
  return headers["retry-after"] !== undefined;
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
    const code =
      error.status === 403 && isRateLimited403(error)
        ? GitHubApiErrorCode.RATE_LIMITED
        : codeForStatus(error.status);
    return {
      code,
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
