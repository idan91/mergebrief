import { HttpStatuses } from "types/http";
import { CredentialFailureCodes, type GitHubCallFailure } from "./client/types";
import { GitHubApiErrorCodes } from "./errors";

/** GitHub's 406: it refuses to render a diff past its size limits. */
export function isNotAcceptable(error: GitHubCallFailure): boolean {
  return "status" in error && error.status === HttpStatuses.NOT_ACCEPTABLE;
}

/** A 406, or a checked diff GitHub served short: no retry reads it whole. */
export function isDiffTooLarge(error: GitHubCallFailure): boolean {
  return (
    isNotAcceptable(error) || error.code === GitHubApiErrorCodes.DIFF_INCOMPLETE
  );
}

/** GitHub's 422 on a diff it did not render in time. */
export function isRenderTimedOut(error: GitHubCallFailure): boolean {
  return (
    "status" in error && error.status === HttpStatuses.UNPROCESSABLE_CONTENT
  );
}

/** A span diff GitHub would not render whole: past its size, or its render timeout. */
export function isSpanUnrendered(error: GitHubCallFailure): boolean {
  const isUnrendered = isDiffTooLarge(error) || isRenderTimedOut(error);
  return isUnrendered;
}

/** An unreadable credential is permanent: a retry reads the same token. */
export function isPermanentGitHubError(error: GitHubCallFailure): boolean {
  const isPermanent =
    error.code === GitHubApiErrorCodes.NOT_FOUND ||
    error.code === GitHubApiErrorCodes.UNAUTHORIZED ||
    error.code === GitHubApiErrorCodes.FORBIDDEN ||
    error.code === CredentialFailureCodes.CREDENTIAL_UNREADABLE ||
    isDiffTooLarge(error);
  return isPermanent;
}
