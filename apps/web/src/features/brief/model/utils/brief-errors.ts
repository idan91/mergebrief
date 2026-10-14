// Curated copy for a failed Brief read or generation. Never the error's own
// message: an `ApiError`'s embeds the request path.
import type { TFunction } from "i18next";
import { ApiError, ApiErrorCodes } from "../../../../data/apiFetch";

/** A Brief route's load failure: every wire code has its `pulls.briefError.<code>` sentence. */
export function prBriefErrorDetail(t: TFunction, error: unknown): string {
  if (!(error instanceof ApiError)) {
    return t("pulls.briefError.generic");
  }
  // Total by construction: the template-literal key type fails to compile
  // on a vocabulary member without a catalog entry.
  return t(`pulls.briefError.${error.code}`);
}

/** Generation's copy (the URL box, regenerate) and Home's load failure. */
export function briefErrorDetail(t: TFunction, error: unknown): string {
  if (!(error instanceof ApiError)) {
    return t("briefError.unexpected");
  }
  switch (error.code) {
    case ApiErrorCodes.NOT_A_PR_URL:
    case ApiErrorCodes.INVALID_REQUEST:
      return t("briefError.not-a-pr-url");
    case ApiErrorCodes.UNAUTHORIZED:
    case ApiErrorCodes.SIGNED_OUT:
      return t("briefError.sessionExpired");
    case ApiErrorCodes.NOT_FOUND:
      return t("briefError.signedFetchFailed");
    default:
      return t("briefError.generation-failed");
  }
}
