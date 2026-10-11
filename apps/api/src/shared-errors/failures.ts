import { GitHubApiErrorCodes, type GitHubCallFailure } from "github";

export const FailureKinds = {
  GITHUB_DENIED: "github-denied",
  SESSION_REJECTED: "session-rejected",
} as const;

/**
 * `resolve` is the fresh re-resolve, which always collapses to the gate's
 * 404; `mutation` is the per-route 403/404 judgment after it.
 */
export interface GitHubDeniedFailure<E> {
  readonly kind: typeof FailureKinds.GITHUB_DENIED;
  readonly phase: "resolve" | "mutation";
  readonly error: E;
}

/** A session-store refusal riding the Result whole (freeze, unknown rows). */
export interface SessionRejectedFailure<E> {
  readonly kind: typeof FailureKinds.SESSION_REJECTED;
  readonly error: E;
}

/**
 * Absent or forbidden, which a reviewer token answers alike for "does not
 * exist" and "not yours", so a second credential may answer; a 5xx or rate
 * limit would only repeat under another token.
 */
export function isGitHubDenial(error: GitHubCallFailure): boolean {
  return (
    error.code === GitHubApiErrorCodes.NOT_FOUND ||
    error.code === GitHubApiErrorCodes.FORBIDDEN
  );
}
