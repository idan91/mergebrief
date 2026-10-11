import {
  CredentialFailureCodes,
  type CredentialFailure,
  type ReviewerCredential,
} from "github";
import type { Logger } from "logging";
import { createSessionAuth, decryptToken } from "persistence";
import type { Result } from "types/utils";
import { refreshSessionToken } from "../routes/auth/session/logic/refresh";
import type {
  AuthRouteDeps,
  ViewerPrincipal,
} from "../routes/auth/session/types";

/** The request's reviewer credential, and the principal it currently holds. */
export interface SessionCredential extends ReviewerCredential {
  /** The rotated principal once a renewal lands: refresh seed, cache keys, audit ids. */
  session(): ViewerPrincipal;
}

const UNREADABLE: CredentialFailure = {
  code: CredentialFailureCodes.CREDENTIAL_UNREADABLE,
  message: "the session's GitHub token would not decrypt",
};

/**
 * One per request. An unreadable token burns the session, so the 401 it
 * answers sends the reviewer to sign in again; the renewal is the session's
 * compare-and-swap refresh, spent at most once however many calls ask.
 */
export function createSessionCredential(
  deps: AuthRouteDeps,
  session: ViewerPrincipal,
  log: Logger,
): SessionCredential {
  let current = session;
  let renewal: Promise<string | undefined> | undefined;

  async function readToken(): Promise<Result<string, CredentialFailure>> {
    const decrypted = await decryptToken(
      deps.auth.keyProvider,
      current.keyRef,
      current.ghTokenCiphertext,
    );
    if (decrypted.ok) {
      return decrypted;
    }
    await createSessionAuth(deps.handle).deleteSession(
      current.sessionTokenHash,
    );
    return { ok: false, error: UNREADABLE };
  }

  async function renewOnce(): Promise<string | undefined> {
    const refreshed = await refreshSessionToken(deps, current, log);
    if (!refreshed.ok) {
      return undefined;
    }
    current = refreshed.value.session;
    return refreshed.value.accessToken;
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
