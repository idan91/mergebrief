import { GitHubApiErrorCode, type GitHubApiError } from "github";

// Shared Result-side failure members. They wrap lower-layer errors WHOLE —
// the handler maps them to posture; nothing translates at the boundary.
/**
 * A GitHub denial on a reviewer-token call. `phase` is what the handler
 * judges: `resolve` (the fresh repo re-resolve — always collapses to the
 * gate's uniform 404 posture) vs `mutation` (after a successful re-resolve —
 * the per-route honest-403/404 judgment).
 */
export interface GitHubDeniedFailure<E> {
  readonly kind: "github-denied";
  readonly phase: "resolve" | "mutation";
  readonly error: E;
}

/** The stored reviewer token would not decrypt — re-auth territory. */
export interface TokenUnreadableFailure {
  readonly kind: "token-unreadable";
}

/** A session-store refusal riding the Result whole (freeze, unknown rows). */
export interface SessionRejectedFailure<E> {
  readonly kind: "session-rejected";
  readonly error: E;
}

export function isTokenUnreadableFailure(
  error: object,
): error is TokenUnreadableFailure {
  return "kind" in error && error.kind === "token-unreadable";
}

/**
 * Shape a `ReviewerGitHubClient.run` refusal as the shared failure Result:
 * token-unreadable passes through whole, anything else wraps as
 * `github-denied` with the caller's phase.
 */
export function buildGitHubDeniedResult<E extends object>(
  error: TokenUnreadableFailure | E,
  phase: GitHubDeniedFailure<E>["phase"],
) {
  if (isTokenUnreadableFailure(error)) {
    return { ok: false, error } as const;
  }
  return {
    ok: false,
    error: { kind: "github-denied", phase, error },
  } as const;
}

/**
 * A denial the caller may answer with a second credential: GitHub says the
 * resource is absent or forbidden, which for an installation-scoped reviewer
 * token is the same answer for "does not exist" and "not in your
 * installation". Anything else (a 5xx, a rate limit) is upstream trouble and
 * a retry under another token would only repeat it.
 */
export function isGitHubDenial(error: GitHubApiError): boolean {
  return (
    error.code === GitHubApiErrorCode.NOT_FOUND ||
    error.code === GitHubApiErrorCode.FORBIDDEN
  );
}
