// A verified callback becomes a session: exchange the code, resolve the
// reviewer, seal both tokens onto a grant row, and create the session that
// links it. No token or secret is ever logged.
import { randomBytes } from "node:crypto";
import {
  exchangeWebFlowCode,
  fetchAuthenticatedUser,
  OAuthErrorCodes,
  type GitHubOAuthApp,
} from "github";
import {
  encryptToken,
  createGrantAuth,
  createSessionAuth,
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

interface SealedSession {
  readonly sessionToken: string;
  readonly reviewerId: ReviewerId;
  readonly reviewerLogin: string;
  readonly ghTokenCiphertext: string;
  readonly ghRefreshTokenCiphertext: string;
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

  const sealedAccess = await encryptToken(
    deps.auth.keyProvider,
    deps.auth.sessionKeyRef,
    tokens.value.accessToken,
  );
  const sealedRefresh = await encryptToken(
    deps.auth.keyProvider,
    deps.auth.sessionKeyRef,
    tokens.value.refreshToken,
  );
  const sealed = sealedAccess.ok && sealedRefresh.ok;
  if (!sealed) {
    log.error("sign-in failed: the GitHub tokens could not be sealed");
    return { ok: false, error: SignInFailures.SIGN_IN_FAILED };
  }

  const sessionToken = randomBytes(SESSION_TOKEN_BYTES).toString("base64url");
  await storeSession(deps, {
    sessionToken,
    reviewerId: user.value.reviewerId,
    reviewerLogin: user.value.reviewerLogin,
    ghTokenCiphertext: sealedAccess.value,
    ghRefreshTokenCiphertext: sealedRefresh.value,
    refreshExpiresAt: tokens.value.refreshTokenExpiresAt,
  });
  return { ok: true, value: sessionToken };
}

/**
 * The credential pair lands on a fresh grant row and the session links it.
 * Session lifetime is the refresh token's; access-token freshness is lazy
 * refresh on a 401.
 */
async function storeSession(
  deps: AuthRouteDeps,
  sealed: SealedSession,
): Promise<void> {
  const grants = createGrantAuth(deps.handle);
  const grant = await grants.createGrant({
    ghTokenCiphertext: sealed.ghTokenCiphertext,
    ghRefreshTokenCiphertext: sealed.ghRefreshTokenCiphertext,
    keyRef: deps.auth.sessionKeyRef,
    refreshExpiresAt: sealed.refreshExpiresAt,
  });
  try {
    await createSessionAuth(deps.handle).createSession({
      sessionTokenHash: sha256Hex(sealed.sessionToken),
      reviewerId: sealed.reviewerId,
      reviewerLogin: sealed.reviewerLogin,
      grantId: grant.id,
      expiresAt: sealed.refreshExpiresAt,
    });
  } catch (error) {
    // A grant that never gained its referent would linger forever: lifecycle
    // cleanup only runs on referent DELETE. Best-effort, since a failure here
    // just leaves an inert, unreferenced ciphertext row.
    await grants.deleteIfOrphaned(grant.id).catch(() => undefined);
    throw error;
  }
}
