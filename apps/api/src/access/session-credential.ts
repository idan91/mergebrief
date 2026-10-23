import {
  RenewalFailureCodes,
  type CredentialFailure,
  type RenewalFailure,
  type ReviewerCredential,
} from "github";
import type { Logger } from "logging";
import { decryptToken } from "persistence";
import type { Result } from "types/utils";
import { refreshSessionToken } from "../routes/auth/session/logic/refresh";
import {
  RefreshErrorCodes,
  type AuthRouteDeps,
  type RefreshErrorCode,
  type ViewerPrincipal,
} from "../routes/auth/session/types";
import { InternalError } from "../shared-errors/api-error";

/** The request's reviewer credential, and the principal it currently holds. */
export interface SessionCredential extends ReviewerCredential {
  /** The rotated principal once a renewal lands: refresh seed, cache keys, audit ids. */
  session(): ViewerPrincipal;
}

/** Refresh failures the operator fixes; the reviewer keeps the session. */
const SERVER_SIDE_REFRESH_FAILURES: ReadonlySet<RefreshErrorCode> = new Set([
  RefreshErrorCodes.CRYPTO_FAILED,
  RefreshErrorCodes.CLIENT_MISCONFIGURED,
]);

/**
 * One per request. The renewal is the session's compare-and-swap refresh,
 * spent at most once however many calls ask. A token the session key cannot
 * open, and a refresh failure the operator owns, answer 500 and keep the
 * session: a key or App misconfiguration never logs anybody out.
 */
export function createSessionCredential(
  deps: AuthRouteDeps,
  session: ViewerPrincipal,
  log: Logger,
): SessionCredential {
  let current = session;
  let renewal: Promise<Result<string, RenewalFailure>> | undefined;

  async function readToken(): Promise<Result<string, CredentialFailure>> {
    const decrypted = await decryptToken(
      deps.auth.keyProvider,
      current.keyRef,
      current.ghTokenCiphertext,
    );
    if (decrypted.ok) {
      return decrypted;
    }
    log.error("the session key could not open the session's GitHub token", {
      evt: "token.decrypt.fail",
      reviewerId: String(current.reviewerId),
    });
    throw new InternalError();
  }

  async function renewOnce(): Promise<Result<string, RenewalFailure>> {
    const refreshed = await refreshSessionToken(deps, current, log);
    if (refreshed.ok) {
      current = refreshed.value.session;
      return { ok: true, value: refreshed.value.accessToken };
    }
    if (SERVER_SIDE_REFRESH_FAILURES.has(refreshed.error.code)) {
      throw new InternalError();
    }
    if (refreshed.error.code === RefreshErrorCodes.UNAVAILABLE) {
      return { ok: false, error: { code: RenewalFailureCodes.UNAVAILABLE } };
    }
    return { ok: false, error: { code: RenewalFailureCodes.REFUSED } };
  }

  return {
    readToken,
    renewToken() {
      renewal ??= renewOnce();
      return renewal;
    },
    session() {
      return current;
    },
  };
}
