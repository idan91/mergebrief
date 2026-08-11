// What the DB-brief route's error boundary shows. Pure and client-safe so it
// can be unit-tested and so nothing here can reach `server-only`.
//
// THE RULE: never render a server-authored `error.message` — SSR loader and
// server-function rejections serialize their own text into the page, Node
// errors carry absolute paths, and `ApiError`'s message embeds the request
// path.
import type { TFunction } from "i18next";
import { ApiError, ApiErrorCode } from "../../../../../data/apiFetch";

export function prBriefErrorDetail(t: TFunction, error: unknown): string {
  if (!(error instanceof ApiError)) return t("pulls.briefError.generic");
  // Total by construction: every ApiErrorCode has a pulls.briefError.<code>
  // catalog key (the template-literal key type would fail to compile on a
  // vocabulary member without one).
  return t(`pulls.briefError.${error.code}`);
}

/** Whether to offer the sign-in CTA alongside the message. */
export function prBriefErrorNeedsSignIn(error: unknown): boolean {
  return error instanceof ApiError && error.code === ApiErrorCode.UNAUTHORIZED;
}
