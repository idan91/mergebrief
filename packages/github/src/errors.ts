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
export function mapRequestError(
  error: unknown,
  context: string,
): GitHubApiError {
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

// GraphQL failures arrive as `GraphqlResponseError` — HTTP 200 with an
// `errors` array whose entries carry a `type` discriminator (`NOT_FOUND`,
// `FORBIDDEN`, `RATE_LIMITED`, …). The octokit umbrella does not export the
// class, and importing `@octokit/graphql` directly would make `instanceof`
// hostage to pnpm resolving the same copy octokit uses — so detection is
// structural: the stable contract is the error name plus the errors array.
interface GraphqlErrorEntry {
  readonly type?: string;
}

function isGraphqlResponseError(error: unknown): error is {
  readonly name: string;
  readonly errors: readonly GraphqlErrorEntry[];
} {
  // Fully structural — no `instanceof Error`, which would reject a wrapped or
  // cross-realm error carrying the same shape (codex round 2).
  if (typeof error !== "object" || error === null) {
    return false;
  }
  return (
    "name" in error &&
    error.name === "GraphqlResponseError" &&
    "errors" in error &&
    Array.isArray(error.errors)
  );
}

// Rate-limit beats forbidden beats not-found: a throttled query can carry
// stale-looking secondary errors, and retry guidance differs per class.
const GRAPHQL_TYPE_PRECEDENCE: ReadonlyArray<{
  readonly type: string;
  readonly code: GitHubApiErrorCode;
}> = [
  { type: "RATE_LIMITED", code: GitHubApiErrorCode.RATE_LIMITED },
  { type: "FORBIDDEN", code: GitHubApiErrorCode.FORBIDDEN },
  { type: "NOT_FOUND", code: GitHubApiErrorCode.NOT_FOUND },
];

/**
 * Map any thrown value from an `octokit.graphql` call into a sanitized
 * `GitHubApiError` — the GraphQL sibling of `mapRequestError`, with the same
 * contract: `context` is a STATIC verb phrase, and no upstream message,
 * token, or response text ever reaches the result. HTTP-level failures
 * (thrown as `RequestError`) delegate to the REST taxonomy.
 */
export function mapGraphqlError(
  error: unknown,
  context: string,
): GitHubApiError {
  if (error instanceof RequestError) {
    return mapRequestError(error, context);
  }
  if (isGraphqlResponseError(error)) {
    const types = new Set(
      error.errors.map((entry) =>
        typeof entry === "object" && entry !== null ? entry.type : undefined,
      ),
    );
    const matched = GRAPHQL_TYPE_PRECEDENCE.find(({ type }) => types.has(type));
    return {
      code: matched?.code ?? GitHubApiErrorCode.REQUEST_FAILED,
      message: `failed to ${context}: GitHub GraphQL query failed`,
    };
  }
  return {
    code: GitHubApiErrorCode.REQUEST_FAILED,
    message: `failed to ${context}: GitHub GraphQL request did not complete`,
  };
}
