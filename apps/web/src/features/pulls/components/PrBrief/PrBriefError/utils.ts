// What the DB-brief route's error boundary shows. Pure and client-safe so it
// can be unit-tested and so nothing here can reach `server-only`.
//
// THE RULE: never render a server-authored `error.message` — SSR loader and
// server-function rejections serialize their own text into the page, Node
// errors carry absolute paths, and `ApiError`'s message embeds the request
// path.
import { ApiError, ApiErrorCode } from "../../../../../data/apiFetch";

const BACKEND_UNREACHABLE =
  "The MergeBrief backend is unreachable right now — try again shortly.";

/** Code-keyed copy. Total, not partial — a new code must be answered here. */
const API_ERROR_DETAIL: Record<ApiErrorCode, string> = {
  [ApiErrorCode.NOT_FOUND]:
    "This pull request (or this span's brief) was not found.",
  [ApiErrorCode.UNAUTHORIZED]: "You need to sign in to read this brief.",
  [ApiErrorCode.SIGN_IN_FAILED]:
    "Signing in didn't complete — try signing in again.",
  [ApiErrorCode.INVALID_SIGNATURE]: "You need to sign in to read this brief.",
  [ApiErrorCode.FORBIDDEN]:
    "You don't have access to this repository's briefs.",
  [ApiErrorCode.GITHUB_PERMISSION]:
    "GitHub denied the app the permission this needs.",
  [ApiErrorCode.APP_NOT_INSTALLED]:
    "The app is not installed for this account.",
  [ApiErrorCode.INVALID_REQUEST]:
    "That request wasn't valid — check the link and try again.",
  [ApiErrorCode.NOT_A_PR_URL]:
    "That link isn't a pull request URL — paste a PR link and try again.",
  [ApiErrorCode.REQUEST_TOO_LARGE]: "That request was too large to process.",
  [ApiErrorCode.DIFF_TOO_LARGE]: "This diff is too large to render.",
  [ApiErrorCode.PR_CHANGED_SINCE_READ]:
    "This pull request changed since it was read — reload to pick up the latest revision, then try again.",
  [ApiErrorCode.PR_REWRITTEN_SINCE_READ]:
    "This pull request was rewritten since it was read — reload to pick up the latest revision, then try again.",
  [ApiErrorCode.GENERATION_FAILED]:
    "Generating this brief failed — try again shortly.",
  [ApiErrorCode.GENERATION_UNAVAILABLE]:
    "Brief generation isn't available on this server right now.",
  [ApiErrorCode.GENERATION_CONFIG]:
    "The generator on this server is misconfigured — check the server logs.",
  [ApiErrorCode.GITHUB_UNAVAILABLE]: BACKEND_UNREACHABLE,
  [ApiErrorCode.INTERNAL_ERROR]: BACKEND_UNREACHABLE,
  [ApiErrorCode.MALFORMED]:
    "The MergeBrief backend returned something this page couldn't read — check the server logs.",
};

/** Anything that is not a recognized ApiError code. */
export const PR_BRIEF_GENERIC_DETAIL =
  "Something went wrong loading this brief — check the server logs.";

export function prBriefErrorDetail(error: unknown): string {
  if (!(error instanceof ApiError)) return PR_BRIEF_GENERIC_DETAIL;
  return API_ERROR_DETAIL[error.code] ?? PR_BRIEF_GENERIC_DETAIL;
}

/** Whether to offer the sign-in CTA alongside the message. */
export function prBriefErrorNeedsSignIn(error: unknown): boolean {
  return error instanceof ApiError && error.code === ApiErrorCode.UNAUTHORIZED;
}
