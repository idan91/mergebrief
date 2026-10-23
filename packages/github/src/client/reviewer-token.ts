import type { Result } from "types/utils";
import { buildRenewalUnavailableError, type GitHubApiError } from "../errors";
import {
  RenewalFailureCodes,
  type CredentialFailure,
  type GitHubCall,
  type RenewalFailure,
  type ReviewerCredential,
} from "./types";
import { isUnauthorized } from "./utils";

export interface TokenState {
  current(): Promise<Result<string, CredentialFailure>>;
  renewPast(rejected: string): Promise<Result<string, RenewalFailure>>;
}

/**
 * The renewal is memoized in flight and never re-spent, so concurrent callers
 * that hit a 401 share one rotation.
 */
export function createTokenState(credential: ReviewerCredential): TokenState {
  let read: Promise<Result<string, CredentialFailure>> | undefined;
  let renewal: Promise<Result<string, RenewalFailure>> | undefined;

  return {
    current() {
      read ??= credential.readToken();
      return read;
    },
    async renewPast(rejected) {
      renewal ??= credential.renewToken(rejected);
      const renewed = await renewal;
      if (renewed.ok) {
        read = Promise.resolve(renewed);
      }
      return renewed;
    },
  };
}

export async function runOnReviewerToken<Value>(
  state: TokenState,
  call: (token: string) => Promise<Result<Value, GitHubApiError>>,
): GitHubCall<Value> {
  const token = await state.current();
  if (!token.ok) {
    return { ok: false, error: token.error };
  }

  const first = await call(token.value);
  if (!isUnauthorized(first)) {
    return first;
  }

  const renewed = await state.renewPast(token.value);
  if (!renewed.ok) {
    if (renewed.error.code === RenewalFailureCodes.UNAVAILABLE) {
      return { ok: false, error: buildRenewalUnavailableError() };
    }
    return first;
  }
  // A 401 on the rotated token itself gets no second rotation.
  if (renewed.value === token.value) {
    return first;
  }
  return call(renewed.value);
}
