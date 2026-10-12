import { ApiError, isSignInRequired } from "../../../../../data/apiFetch";

/** Whether to offer the sign-in CTA alongside the message. */
export function prBriefErrorNeedsSignIn(error: unknown): boolean {
  return error instanceof ApiError && isSignInRequired(error.code);
}
