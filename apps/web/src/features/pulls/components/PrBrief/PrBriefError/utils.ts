// What the DB-brief route's error boundary shows. Pure and client-safe so it
// can be unit-tested and so nothing here can reach `server-only`.
//
// THE RULE: never render a server-authored `error.message` — SSR loader and
// server-function rejections serialize their own text into the page, Node
// errors carry absolute paths, and `ApiError`'s message embeds the request
// path.
import { ApiError, ApiErrorKind } from "../../../../../data/apiFetch";

/** Kind-keyed copy. Total, not partial — a new kind must be answered here. */
const API_ERROR_DETAIL: Record<ApiErrorKind, string> = {
  [ApiErrorKind.NOT_FOUND]:
    "This pull request (or this span's brief) was not found.",
  [ApiErrorKind.UNAUTHORIZED]: "You need to sign in to read this brief.",
  [ApiErrorKind.FORBIDDEN]:
    "You don't have access to this repository's briefs.",
  [ApiErrorKind.BAD_REQUEST]:
    "That request wasn't valid — check the link and try again.",
  [ApiErrorKind.TOO_LARGE]: "That request was too large to process.",
  [ApiErrorKind.UNAVAILABLE]:
    "The MergeBrief backend is unreachable right now — try again shortly.",
  [ApiErrorKind.UPSTREAM]:
    "The MergeBrief backend is unreachable right now — try again shortly.",
  [ApiErrorKind.MALFORMED]:
    "The MergeBrief backend returned something this page couldn't read — check the server logs.",
};

/** Anything that is not a recognized ApiError kind. */
export const PR_BRIEF_GENERIC_DETAIL =
  "Something went wrong loading this brief — check the server logs.";

export function prBriefErrorDetail(error: unknown): string {
  if (!(error instanceof ApiError)) return PR_BRIEF_GENERIC_DETAIL;
  return API_ERROR_DETAIL[error.kind] ?? PR_BRIEF_GENERIC_DETAIL;
}

/** Whether to offer the sign-in CTA alongside the message. */
export function prBriefErrorNeedsSignIn(error: unknown): boolean {
  return error instanceof ApiError && error.kind === ApiErrorKind.UNAUTHORIZED;
}
