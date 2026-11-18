import {
  CredentialFailureCodes,
  GitHubApiErrorCodes,
  type GitHubCallFailure,
} from "github";

/**
 * A viewer whose token GitHub refuses, or whose token the binding could not
 * read, must reach sign-in again; an empty list would hide that.
 */
export function isDeadCredential(error: GitHubCallFailure): boolean {
  const deadCredential =
    error.code === GitHubApiErrorCodes.UNAUTHORIZED ||
    error.code === CredentialFailureCodes.CREDENTIAL_UNREADABLE;
  return deadCredential;
}
