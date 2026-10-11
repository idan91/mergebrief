import { GitHubApiErrorCodes, type GitHubCallFailure } from "github";

export const FailureKinds = {
  GITHUB_DENIED: "github-denied",
  TOKEN_UNREADABLE: "token-unreadable",
  SESSION_REJECTED: "session-rejected",
} as const;

// Shared Result-side failure members. They wrap lower-layer errors WHOLE:
// the handler maps them to posture; nothing translates at the boundary.
/**
 * A GitHub denial on a reviewer-token call. `phase` is what the handler
 * judges: `resolve` (the fresh repo re-resolve, which always collapses to
 * the gate's uniform 404 posture) vs `mutation` (after a successful
 * re-resolve, the per-route honest-403/404 judgment).
 */
export interface GitHubDeniedFailure<E> {
  readonly kind: typeof FailureKinds.GITHUB_DENIED;
  readonly phase: "resolve" | "mutation";
  readonly error: E;
}

/** The stored reviewer token would not decrypt: re-auth territory. */
export interface TokenUnreadableFailure {
  readonly kind: typeof FailureKinds.TOKEN_UNREADABLE;
}

/** A session-store refusal riding the Result whole (freeze, unknown rows). */
export interface SessionRejectedFailure<E> {
  readonly kind: typeof FailureKinds.SESSION_REJECTED;
  readonly error: E;
}

export function isTokenUnreadableFailure(
  error: object,
): error is TokenUnreadableFailure {
  return "kind" in error && error.kind === FailureKinds.TOKEN_UNREADABLE;
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
    error: { kind: FailureKinds.GITHUB_DENIED, phase, error },
  } as const;
}

/**
 * A denial the caller may answer with a second credential: GitHub says the
 * resource is absent or forbidden, which for an installation-scoped reviewer
 * token is the same answer for "does not exist" and "not in your
 * installation". Anything else (a 5xx, a rate limit) is upstream trouble and
 * a retry under another token would only repeat it.
 */
export function isGitHubDenial(error: GitHubCallFailure): boolean {
  return (
    error.code === GitHubApiErrorCodes.NOT_FOUND ||
    error.code === GitHubApiErrorCodes.FORBIDDEN
  );
}
