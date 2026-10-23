// A verified callback becomes a session: exchange the code, resolve the
// reviewer, hand both tokens to a new grant row that seals them, and create
// the session that links it. No token or secret is ever logged.
import { randomBytes } from "node:crypto";
import {
  exchangeWebFlowCode,
  fetchAuthenticatedUser,
  OAuthErrorCodes,
  type GitHubOAuthApp,
} from "github";
import {
  createGrantAuth,
  createSessionAuth,
  type CryptoError,
  type ReviewerId,
} from "persistence";
import { SignInFailures, type SignInFailure } from "contract";
import type { Logger } from "logging";
import type { Result } from "types";
import type { AuthRouteDeps } from "../session/types";
import { sha256Hex } from "../session/utils";

const SESSION_TOKEN_BYTES = 32;

/** The callback's query once its state matched the cookie. */
export interface VerifiedCallback {
  readonly code: string;
  readonly state: string;
}

interface SignedInSession {
  readonly sessionToken: string;
  readonly reviewerId: ReviewerId;
  readonly reviewerLogin: string;
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly refreshExpiresAt: Date;
}

/** Answers the session token the cookie carries. */
export async function completeSignIn(
  deps: AuthRouteDeps,
  oauthApp: GitHubOAuthApp,
  callback: VerifiedCallback,
  log: Logger,
): Promise<Result<string, SignInFailure>> {
  const tokens = await exchangeWebFlowCode(oauthApp, callback);
  if (!tokens.ok) {
    if (tokens.error.code === OAuthErrorCodes.CLIENT_MISCONFIGURED) {
      log.error("sign-in refused: GitHub refused the App's OAuth credentials", {
        kind: tokens.error.oauthError,
      });
    } else {
      log.debug("sign-in refused: GitHub rejected the code");
    }
    return { ok: false, error: SignInFailures.SIGN_IN_FAILED };
  }

  const user = await fetchAuthenticatedUser(tokens.value.accessToken);
  if (!user.ok) {
    log.warn("sign-in failed: GitHub did not answer the user read");
    return { ok: false, error: SignInFailures.GITHUB_UNAVAILABLE };
  }

  const sessionToken = randomBytes(SESSION_TOKEN_BYTES).toString("base64url");
  const stored = await storeSession(deps, {
    sessionToken,
    reviewerId: user.value.reviewerId,
    reviewerLogin: user.value.reviewerLogin,
    accessToken: tokens.value.accessToken,
    refreshToken: tokens.value.refreshToken,
    refreshExpiresAt: tokens.value.refreshTokenExpiresAt,
  });
  if (!stored.ok) {
    log.error("sign-in failed: the GitHub tokens could not be sealed");
    return { ok: false, error: SignInFailures.SIGN_IN_FAILED };
  }
  return { ok: true, value: sessionToken };
}

/**
 * The credential pair lands sealed on a fresh grant row and the session links
 * it; a key the provider cannot resolve stores nothing. Session lifetime is
 * the refresh token's; access-token freshness is lazy refresh on a 401.
 */
async function storeSession(
  deps: AuthRouteDeps,
  signedIn: SignedInSession,
): Promise<Result<undefined, CryptoError>> {
  const grants = createGrantAuth(deps.handle);
  const created = await grants.createGrant({
    userId: signedIn.reviewerId,
    accessToken: signedIn.accessToken,
    refreshToken: signedIn.refreshToken,
    keyProvider: deps.auth.keyProvider,
    keyRef: deps.auth.sessionKeyRef,
    refreshExpiresAt: signedIn.refreshExpiresAt,
  });
  if (!created.ok) {
    return created;
  }

  const grant = created.value;
  try {
    await createSessionAuth(deps.handle).createSession({
      sessionTokenHash: sha256Hex(signedIn.sessionToken),
      reviewerId: signedIn.reviewerId,
      reviewerLogin: signedIn.reviewerLogin,
      grantId: grant.id,
      expiresAt: signedIn.refreshExpiresAt,
    });
  } catch (error) {
    // A grant that never gained its referent would linger forever: lifecycle
    // cleanup only runs on referent DELETE. Best-effort, since a failure here
    // just leaves an inert, unreferenced ciphertext row.
    await grants.deleteIfOrphaned(grant.id).catch(() => undefined);
    throw error;
  }
  return { ok: true, value: undefined };
}
