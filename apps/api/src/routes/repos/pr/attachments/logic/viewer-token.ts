import {
  GitHubApiErrorCodes,
  RenewalFailureCodes,
  buildRenewalUnavailableError,
  type GitHubApiError,
  type GitHubCallFailure,
  type ReviewerCredential,
} from "github";
import type { Result } from "types";

/**
 * One GitHub request on the viewer's own token: a 401 renews the request's
 * credential once and asks again, as the bindings do. Never the operator
 * token: a file read this way is tied to no granted pull request.
 */
export async function callWithViewerToken<Value>(
  credential: ReviewerCredential,
  call: (token: string) => Promise<Result<Value, GitHubApiError>>,
): Promise<Result<Value, GitHubCallFailure>> {
  const token = await credential.readToken();
  if (!token.ok) {
    return token;
  }

  const first = await call(token.value);
  if (first.ok || first.error.code !== GitHubApiErrorCodes.UNAUTHORIZED) {
    return first;
  }

  const renewed = await credential.renewToken(token.value);
  if (!renewed.ok) {
    if (renewed.error.code === RenewalFailureCodes.UNAVAILABLE) {
      return { ok: false, error: buildRenewalUnavailableError() };
    }
    return first;
  }
  if (renewed.value === token.value) {
    return first;
  }
  return call(renewed.value);
}
