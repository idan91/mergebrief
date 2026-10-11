// The per-request reviewer-identity GitHub channel; counterpart of the
// App's installation binding. One instance per request: the stored token is
// decrypted lazily ONCE, and an expired call spends the request's single
// refresh (`refreshSessionToken`) before re-running; the token can expire
// between calls, and per-call-site refresh logic either misses that or
// refreshes more than once. Hand-rolled refresh locals are banned.
import { GitHubApiErrorCodes, type UserOctokitFactory } from "github";
import {
  FailureKinds,
  type TokenUnreadableFailure,
} from "../../shared-errors/failures";
import type { Logger } from "logging";
import { decryptToken } from "persistence";
import type { Result } from "types/utils";
import type {
  AuthRouteDeps,
  RefreshedSession,
  RefreshError,
  ViewerPrincipal,
} from "./session/types";
import { refreshSessionToken } from "./session/logic/refresh";

export type UserOctokit = ReturnType<UserOctokitFactory>;

/**
 * What `run` and `runRead` answer. `retried` is true when the call re-ran on
 * the token the request's single refresh rotated in; the operator rung is not
 * a retry. `tokenUnreadable` tells the client's own failure from the call's.
 */
export type GitHubCallOutcome<T, E> =
  | GitHubCallSucceeded<T>
  | GitHubCallFailed<E>
  | GitHubCallTokenUnreadable;

export interface GitHubCallSucceeded<T> {
  readonly ok: true;
  readonly value: T;
  readonly retried: boolean;
}

export interface GitHubCallFailed<E> {
  readonly ok: false;
  readonly tokenUnreadable: false;
  readonly error: E;
  readonly retried: boolean;
}

export interface GitHubCallTokenUnreadable {
  readonly ok: false;
  readonly tokenUnreadable: true;
  readonly error: TokenUnreadableFailure;
  readonly retried: false;
}

export interface ReviewerGitHubClient {
  /**
   * Run a token-taking GitHub call. On expiry (default predicate: a
   * `GitHubApiErrorCodes.UNAUTHORIZED` code) the request's single refresh is
   * spent and the call re-runs once with the rotated token; a failed or
   * already-spent refresh returns the original error unchanged.
   */
  run<T, E>(
    call: (accessToken: string) => Promise<Result<T, E>>,
    isExpired?: (error: E) => boolean,
  ): Promise<GitHubCallOutcome<T, E>>;
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
  ): Promise<GitHubCallOutcome<T, E>>;
  /** The GitHub client for a token `run` or `runRead` handed out. */
  createOctokit(accessToken: string): UserOctokit;
  /**
   * A create rides a client with octokit's retry off: GitHub can apply a POST
   * and still answer 5xx, so a replay is a second comment, thread or review,
   * never a repeat of the first.
   */
  createMutationOctokit(accessToken: string): UserOctokit;
  /** The possibly-rotated session (refresh CAS seed, cache keys, audit ids). */
  session(): ViewerPrincipal;
}

function isUnauthorizedCode(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === GitHubApiErrorCodes.UNAUTHORIZED
  );
}

/**
 * The longest rate-limit wait a write honours. A longer one could carry the
 * write past its claim's lease, when another attempt may already have sent it.
 */
const MUTATION_MAX_RETRY_AFTER_SECONDS = 20;

const TOKEN_UNREADABLE: GitHubCallTokenUnreadable = {
  ok: false,
  tokenUnreadable: true,
  error: { kind: FailureKinds.TOKEN_UNREADABLE },
  retried: false,
};

function shapeCallOutcome<T, E>(
  result: Result<T, E>,
  retried: boolean,
): GitHubCallOutcome<T, E> {
  if (result.ok) {
    return { ok: true, value: result.value, retried };
  }
  return { ok: false, tokenUnreadable: false, error: result.error, retried };
}

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

  async function resolveToken(): Promise<string | undefined> {
    if (accessToken !== undefined) {
      return accessToken;
    }
    const decrypted = await decryptToken(
      deps.auth.keyProvider,
      currentSession.keyRef,
      currentSession.ghTokenCiphertext,
    );
    if (!decrypted.ok) {
      return undefined;
    }
    accessToken = decrypted.value;
    return accessToken;
  }

  return {
    async run<T, E>(
      call: (token: string) => Promise<Result<T, E>>,
      isExpired: (error: E) => boolean = isUnauthorizedCode,
    ): Promise<GitHubCallOutcome<T, E>> {
      const usedToken = await resolveToken();
      if (usedToken === undefined) {
        return TOKEN_UNREADABLE;
      }

      const result = await call(usedToken);
      if (result.ok || !isExpired(result.error)) {
        return shapeCallOutcome(result, false);
      }

      refresh ??= refreshSessionToken(deps, currentSession, log);
      const refreshed = await refresh;
      if (!refreshed.ok) {
        return shapeCallOutcome(result, false);
      }
      currentSession = refreshed.value.session;
      accessToken = refreshed.value.accessToken;
      // Re-run ONLY a call that ran on the pre-rotation token; a 401 on the
      // rotated token itself gets no second spend.
      if (accessToken === usedToken) {
        return shapeCallOutcome(result, false);
      }
      const rerun = await call(accessToken);
      return shapeCallOutcome(rerun, true);
    },
    async runRead<T, E>(
      call: (token: string) => Promise<Result<T, E>>,
      isDenied: (error: E) => boolean,
      isExpired: (error: E) => boolean = isUnauthorizedCode,
    ): Promise<GitHubCallOutcome<T, E>> {
      const own = await this.run(call, isExpired);
      if (own.ok || readFallbackToken === undefined) {
        return own;
      }
      if (own.tokenUnreadable || !isDenied(own.error)) {
        return own;
      }

      const fallback = await call(readFallbackToken);
      if (fallback.ok || !isExpired(fallback.error)) {
        return shapeCallOutcome(fallback, own.retried);
      }
      // The OPERATOR's key is what GitHub rejected. Returning its 401 would
      // send the reader to re-authenticate, which cannot repair a credential
      // that is not theirs; the reader's own denial is the honest answer.
      log.warn(
        "url-box fallback token rejected by GitHub — check the operator PAT",
      );
      return own;
    },
    createOctokit(token: string): UserOctokit {
      return deps.auth.createUserOctokit(token);
    },
    createMutationOctokit(token: string): UserOctokit {
      return deps.auth.createUserOctokit(token, {
        retry: false,
        maxRetryAfterSeconds: MUTATION_MAX_RETRY_AFTER_SECONDS,
      });
    },
    session(): ViewerPrincipal {
      return currentSession;
    },
  };
}
