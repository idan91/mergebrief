// The single sanitization chokepoint for GitHub API failures: every thrown
// error funnels through `mapRequestError`/`mapGraphqlError` so no auth header,
// token, request URL, or raw response body reaches a `Result` error, only an
// HTTP status and a static, caller-supplied context string.
import { RequestError } from "octokit";
import type { ValueOf } from "./types";

export const GitHubApiErrorCodes = {
  NOT_FOUND: "not-found",
  FORBIDDEN: "forbidden",
  UNAUTHORIZED: "unauthorized",
  RATE_LIMITED: "rate-limited",
  /** A 200 whose payload is a directory, symlink or submodule, not a blob. */
  NOT_A_BLOB: "not-a-blob",
  /** A blob whose base64 payload does not decode as UTF-8 text. */
  NOT_TEXT: "not-text",
  /** A push or delete a repository rule refused; the App's permission is not the cause. */
  RULE_REFUSED: "rule-refused",
  REQUEST_FAILED: "request-failed",
} as const;
export type GitHubApiErrorCode = ValueOf<typeof GitHubApiErrorCodes>;

export interface GitHubApiError {
  readonly code: GitHubApiErrorCode;
  /** HTTP status, when the failure was an HTTP response (absent for network/transport errors). */
  readonly status?: number;
  /**
   * Sanitized summary. Derived only from the HTTP status and a static context
   * label, never the upstream message, response body, or request headers
   * (which may carry the installation token).
   */
  readonly message: string;
}

/**
 * GitHub signals throttling with a 403 (NOT 429) plus rate-limit headers:
 * `x-ratelimit-remaining: 0` for the primary limit, or `retry-after` for a
 * secondary/abuse limit. Headers only, never the body.
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
      return GitHubApiErrorCodes.UNAUTHORIZED;
    }
    case 403: {
      return GitHubApiErrorCodes.FORBIDDEN;
    }
    case 404: {
      return GitHubApiErrorCodes.NOT_FOUND;
    }
    case 429: {
      return GitHubApiErrorCodes.RATE_LIMITED;
    }
    default: {
      return GitHubApiErrorCodes.REQUEST_FAILED;
    }
  }
}

/**
 * Map any thrown value from an octokit request into a sanitized
 * `GitHubApiError`. `context` must be a STATIC verb phrase supplied by the
 * caller, never interpolated from user/GitHub input.
 */
export function mapRequestError(
  error: unknown,
  context: string,
): GitHubApiError {
  if (error instanceof RequestError) {
    const code =
      error.status === 403 && isRateLimited403(error)
        ? GitHubApiErrorCodes.RATE_LIMITED
        : codeForStatus(error.status);
    return {
      code,
      status: error.status,
      message: `failed to ${context}: GitHub API returned status ${error.status}`,
    };
  }
  return {
    code: GitHubApiErrorCodes.REQUEST_FAILED,
    message: `failed to ${context}: GitHub API request did not complete`,
  };
}

/**
 * A 200 the caller asked to read as a file that is something else: a
 * directory listing, a symlink, a submodule pointer. PERMANENT for this path
 * and ref, so a caller answers rather than inviting a retry.
 */
export function notABlobError(context: string): GitHubApiError {
  return {
    code: GitHubApiErrorCodes.NOT_A_BLOB,
    message: `failed to ${context}: path is not a file blob`,
  };
}

/**
 * A blob that arrived but is not UTF-8 text: malformed base64, or bytes no
 * decoder accepts. PERMANENT for this path and ref, like `not-a-blob`, so a
 * caller answers rather than retrying against the same bytes.
 */
export function notTextError(context: string): GitHubApiError {
  return {
    code: GitHubApiErrorCodes.NOT_TEXT,
    message: `failed to ${context}: file is not utf-8 text`,
  };
}

/** Build a sanitized `GitHubApiError` for an unexpected/ill-shaped 2xx response body. */
export function unexpectedResponseError(context: string): GitHubApiError {
  return {
    code: GitHubApiErrorCodes.REQUEST_FAILED,
    message: `failed to ${context}: unexpected GitHub API response shape`,
  };
}

// GraphQL failures arrive as `GraphqlResponseError`: HTTP 200 with an
// `errors` array carrying a `type` discriminator. The octokit umbrella does
// not export the class, so detection is structural (name + errors array)
// rather than `instanceof`.
interface GraphqlErrorEntry {
  readonly type?: string;
}

function isGraphqlResponseError(error: unknown): error is {
  readonly name: string;
  readonly errors: readonly GraphqlErrorEntry[];
} {
  // Fully structural: `instanceof Error` would reject a wrapped or
  // cross-realm error carrying the same shape.
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

/**
 * Whether a thrown GraphQL response carries entries of `type` and nothing
 * else; a mixed array keeps its rate-limit or auth classification.
 */
export function hasOnlyGraphqlErrorType(error: unknown, type: string): boolean {
  if (!isGraphqlResponseError(error) || error.errors.length === 0) {
    return false;
  }
  return error.errors.every(
    (entry) =>
      typeof entry === "object" && entry !== null && entry.type === type,
  );
}

// Rate-limit beats forbidden beats not-found: a throttled query can carry
// stale-looking secondary errors, and retry guidance differs per class.
const GRAPHQL_TYPE_PRECEDENCE: ReadonlyArray<{
  readonly type: string;
  readonly code: GitHubApiErrorCode;
}> = [
  { type: "RATE_LIMITED", code: GitHubApiErrorCodes.RATE_LIMITED },
  { type: "FORBIDDEN", code: GitHubApiErrorCodes.FORBIDDEN },
  { type: "NOT_FOUND", code: GitHubApiErrorCodes.NOT_FOUND },
];

/**
 * Sanitizing sibling of `mapRequestError` for `octokit.graphql` calls: same
 * contract: `context` is a STATIC verb phrase, and no upstream message,
 * token, or response text reaches the result.
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
      code: matched?.code ?? GitHubApiErrorCodes.REQUEST_FAILED,
      message: `failed to ${context}: GitHub GraphQL query failed`,
    };
  }
  return {
    code: GitHubApiErrorCodes.REQUEST_FAILED,
    message: `failed to ${context}: GitHub GraphQL request did not complete`,
  };
}
