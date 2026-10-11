import type { Result } from "types/utils";
import type { GitHubApiError } from "../errors";
import type {
  CredentialFailure,
  GitHubCall,
  ReviewerCredential,
} from "./types";
import { isUnauthorized } from "./utils";

export interface TokenState {
  current(): Promise<Result<string, CredentialFailure>>;
  renewPast(rejected: string): Promise<string | undefined>;
}

/**
 * The renewal is memoized in flight and never re-spent, so concurrent callers
 * that hit a 401 share one rotation.
 */
export function createTokenState(credential: ReviewerCredential): TokenState {
  let read: Promise<Result<string, CredentialFailure>> | undefined;
  let renewal: Promise<string | undefined> | undefined;

  return {
    current() {
      read ??= credential.readToken();
      return read;
    },
    async renewPast(rejected) {
      renewal ??= credential.renewToken(rejected);
      const renewed = await renewal;
      if (renewed !== undefined) {
        read = Promise.resolve({ ok: true, value: renewed });
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
  // A 401 on the rotated token itself gets no second rotation.
  const rotatedPastCall = renewed !== undefined && renewed !== token.value;
  if (!rotatedPastCall) {
    return first;
  }
  return call(renewed);
}
