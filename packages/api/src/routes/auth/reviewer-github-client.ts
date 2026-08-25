// The per-request reviewer-identity GitHub channel — counterpart of
// `InstallationGitHubPort`. One instance per request: the stored token is
// decrypted lazily ONCE, and an expired call spends the request's single
// refresh (`refreshSessionToken`) before re-running — the token can expire
// between calls, and per-call-site refresh logic either misses that or
// refreshes more than once. Hand-rolled refresh locals are banned.
import { GitHubApiErrorCode } from "github";
import {
  isTokenUnreadableFailure,
  type TokenUnreadableFailure,
} from "../../shared-errors/failures";
import type { Logger } from "logging";
import { decryptToken } from "persistence";
import type { Result } from "types";
import {
  refreshSessionToken,
  type AuthRouteDeps,
  type RefreshedSession,
  type RefreshError,
  type ViewerPrincipal,
} from "./session";

/** The stored ciphertext could not be decrypted — re-auth territory; the
 * caller owns the posture (burn the session, 401, …). One shape with the
 * shared failure vocabulary so the two can never drift. */
export type ReviewerTokenFailure = TokenUnreadableFailure;

export interface ReviewerGitHubClient {
  /**
   * Run a token-taking GitHub call. On expiry (default predicate: a
   * `GitHubApiErrorCode.UNAUTHORIZED` code) the request's single refresh is
   * spent and the call re-runs once with the rotated token; a failed or
   * already-spent refresh returns the original error unchanged.
   */
  run<T, E>(
    call: (accessToken: string) => Promise<Result<T, E>>,
    isExpired?: (error: E) => boolean,
  ): Promise<Result<T, E | ReviewerTokenFailure>>;
  /**
   * `run` for a READ, with the operator PAT as a second rung when the gate
   * passed this request on that PAT (the client is built with the token only
   * then). Reads only: a write must never leave GitHub attributing the
   * operator for something a reader did.
   */
  runRead<T, E>(
    call: (accessToken: string) => Promise<Result<T, E>>,
    isDenied: (error: E) => boolean,
    isExpired?: (error: E) => boolean,
  ): Promise<Result<T, E | ReviewerTokenFailure>>;
  /** The possibly-rotated session (refresh CAS seed, cache keys, audit ids). */
  session(): ViewerPrincipal;
}

/** The client's own failure member, told apart from the call's error type. */
function isOwnTokenFailure(error: unknown): error is ReviewerTokenFailure {
  return (
    typeof error === "object" &&
    error !== null &&
    isTokenUnreadableFailure(error)
  );
}

function isUnauthorizedCode(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === GitHubApiErrorCode.UNAUTHORIZED
  );
}

const TOKEN_UNREADABLE: Result<never, ReviewerTokenFailure> = {
  ok: false,
  error: { kind: "token-unreadable" },
};

export function createReviewerGitHubClient(
  deps: AuthRouteDeps,
  session: ViewerPrincipal,
  log: Logger,
  /** Present only when the gate passed this request on the operator PAT. */
  readFallbackToken?: string,
): ReviewerGitHubClient {
  let currentSession = session;
  let accessToken: string | undefined;
  // The request's single refresh, memoized in flight so a concurrent loser
  // awaits the winner's rotation instead of surfacing a stale 401.
  let refresh: Promise<Result<RefreshedSession, RefreshError>> | undefined;

  async function resolveToken(): Promise<Result<string, ReviewerTokenFailure>> {
    if (accessToken !== undefined) {
      return { ok: true, value: accessToken };
    }
    const decrypted = await decryptToken(
      deps.auth.keyProvider,
      currentSession.keyRef,
      currentSession.ghTokenCiphertext,
    );
    if (!decrypted.ok) {
      return TOKEN_UNREADABLE;
    }
    accessToken = decrypted.value;
    return { ok: true, value: accessToken };
  }

  return {
    async run<T, E>(
      call: (token: string) => Promise<Result<T, E>>,
      isExpired: (error: E) => boolean = isUnauthorizedCode,
    ): Promise<Result<T, E | ReviewerTokenFailure>> {
      const token = await resolveToken();
      if (!token.ok) {
        return token;
      }
      const usedToken = token.value;
      const result = await call(usedToken);
      if (result.ok || !isExpired(result.error)) {
        return result;
      }
      refresh ??= refreshSessionToken(deps, currentSession, log);
      const refreshed = await refresh;
      if (!refreshed.ok) {
        return result;
      }
      currentSession = refreshed.value.session;
      accessToken = refreshed.value.accessToken;
      // Re-run ONLY a call that ran on the pre-rotation token — a 401 on the
      // rotated token itself gets no second spend.
      if (accessToken === usedToken) {
        return result;
      }
      return call(accessToken);
    },
    async runRead<T, E>(
      call: (token: string) => Promise<Result<T, E>>,
      isDenied: (error: E) => boolean,
      isExpired: (error: E) => boolean = isUnauthorizedCode,
    ): Promise<Result<T, E | ReviewerTokenFailure>> {
      const own = await this.run(call, isExpired);
      if (own.ok || readFallbackToken === undefined) {
        return own;
      }
      if (isOwnTokenFailure(own.error) || !isDenied(own.error)) {
        return own;
      }
      const fallback = await call(readFallbackToken);
      if (fallback.ok || !isExpired(fallback.error)) {
        return fallback;
      }
      // The OPERATOR's key is what GitHub rejected. Returning its 401 would
      // send the reader to re-authenticate, which cannot repair a credential
      // that is not theirs — the reader's own denial is the honest answer.
      log.warn(
        "url-box fallback token rejected by GitHub — check the operator PAT",
      );
      return own;
    },
    session(): ViewerPrincipal {
      return currentSession;
    },
  };
}
