// The serialized token-refresh orchestrator the authz gate calls on a 401,
// ONE for both presentation channels, anchored on the grant row. Tokens are
// sealed with `encryptToken` before they touch a row; nothing here logs one.
import { createOAuthApp, refreshUserToken, type GitHubOAuthApp } from "github";
import {
  decryptToken,
  encryptToken,
  createGrantAuth,
  GrantAuthErrorCodes,
  createSessionAuth,
  createTokenAuth,
  type GithubGrantRow,
  type GrantRefreshPatch,
  type GrantRefreshRejection,
} from "persistence";
import type { Logger } from "logging";
import type { Mutable, Result } from "types";
import {
  AuthChannels,
  RefreshErrorCodes,
  type AuthRouteDeps,
  type RefreshError,
  type RefreshedSession,
  type ViewerPrincipal,
} from "../types";

/**
 * The GitHub rotation shared by both channels: decrypt the stored refresh
 * token, exchange it, seal the rotated pair. Returns the grant patch plus the
 * rotated plaintext access token for immediate use.
 */
async function rotateGitHubTokens(
  deps: AuthRouteDeps,
  oauthApp: GitHubOAuthApp,
  locked: GithubGrantRow,
): Promise<
  Result<
    { patch: GrantRefreshPatch; accessToken: string },
    GrantRefreshRejection
  >
> {
  const decryptedRefresh = await decryptToken(
    deps.auth.keyProvider,
    locked.keyRef,
    locked.ghRefreshTokenCiphertext,
  );
  if (!decryptedRefresh.ok) {
    return { ok: false, error: { reason: "decrypt-refresh-token-failed" } };
  }
  const tokens = await refreshUserToken(oauthApp, {
    refreshToken: decryptedRefresh.value,
  });
  if (!tokens.ok) {
    return { ok: false, error: { reason: "github-refresh-failed" } };
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
  if (!sealedAccess.ok || !sealedRefresh.ok) {
    return { ok: false, error: { reason: "encrypt-token-failed" } };
  }
  return {
    ok: true,
    value: {
      patch: {
        ghTokenCiphertext: sealedAccess.value,
        ghRefreshTokenCiphertext: sealedRefresh.value,
        keyRef: deps.auth.sessionKeyRef,
        refreshExpiresAt: tokens.value.refreshTokenExpiresAt,
      },
      accessToken: tokens.value.accessToken,
    },
  };
}

/**
 * ONE refresh orchestrator for both channels, anchored on the grant row. The
 * caller passes the principal it ALREADY held when GitHub 401ed, never a
 * re-resolved one: its `ghTokenCiphertext` is the compare-and-swap seed. If it
 * no longer matches under the grant lock, another request already rotated and
 * the stored token is returned without a GitHub call (the refresh token is
 * single-use). Cookie failure deletes the session; bearer deletes nothing. On
 * cookie success `expires_at` mirrors the grant's `refresh_expires_at`, also
 * on the short-circuit path, since the bearer channel never mirrors.
 */
export async function refreshSessionToken(
  deps: AuthRouteDeps,
  session: ViewerPrincipal,
  log: Logger,
): Promise<Result<RefreshedSession, RefreshError>> {
  const oauthApp = createOAuthApp({
    clientId: deps.auth.oauthClientId,
    clientSecret: deps.auth.oauthClientSecret,
  });
  const isCookie = session.channel === AuthChannels.COOKIE;

  // The one posture fork: cookie burns its session on any unrecoverable arm;
  // bearer leaves the row for its owner to see and revoke.
  const failChannel = async (
    message: string,
  ): Promise<Result<RefreshedSession, RefreshError>> => {
    if (isCookie) {
      await createSessionAuth(deps.handle).deleteSession(
        session.sessionTokenHash,
      );
    }
    log.error(isCookie ? `${message}; session deleted` : message, {
      evt: "token.refresh.fail",
      reviewerId: String(session.reviewerId),
    });
    return {
      ok: false,
      error: {
        code: RefreshErrorCodes.REFRESH_FAILED,
        message: "refresh failed; re-authentication required",
      },
    };
  };

  // Captured from a successful GitHub rotation so we can return the plaintext
  // access token without re-decrypting what we just sealed.
  let rotatedAccessToken: string | undefined;

  const refreshed = await createGrantAuth(deps.handle).refreshGrant(
    session.grantId,
    session.ghTokenCiphertext,
    async (locked) => {
      const rotated = await rotateGitHubTokens(deps, oauthApp, locked);
      if (!rotated.ok) {
        return rotated;
      }
      rotatedAccessToken = rotated.value.accessToken;
      return { ok: true, value: rotated.value.patch };
    },
  );

  if (!refreshed.ok) {
    if (refreshed.error.code === GrantAuthErrorCodes.NOT_FOUND) {
      // The grant vanished under us, its last referent (this very row) was
      // deleted concurrently (logout / sweep / purge). Nothing to clean up;
      // the caller re-authenticates.
      return {
        ok: false,
        error: {
          code: RefreshErrorCodes.NOT_FOUND,
          message: "grant not found",
        },
      };
    }
    // REFRESH_REJECTED: decrypt / GitHub rotation / re-encrypt failed.
    return failChannel("grant refresh failed");
  }

  const grant = refreshed.value;
  // Re-verify the REFERENT after the rotation: the grant lock does not see
  // session/token state, so a referent that died mid-request, logout, sweep,
  // owner revoke, must not receive the fresh token. The rotation itself
  // stands either way (it benefits the grant's surviving referents).
  if (isCookie) {
    // The expiry mirror doubles as the liveness check: 0 rows touched means
    // the session vanished while we rotated → re-login, nothing to delete.
    const touched = await createSessionAuth(deps.handle).setExpiresAt(
      session.sessionTokenHash,
      grant.refreshExpiresAt,
    );
    if (touched === 0) {
      return {
        ok: false,
        error: {
          code: RefreshErrorCodes.NOT_FOUND,
          message: "session not found",
        },
      };
    }
  } else {
    const live = await createTokenAuth(deps.handle).resolveByHash(
      session.sessionTokenHash,
      new Date(),
    );
    if (!live.ok) {
      // Revoked/expired/deleted mid-request, same hint-free re-auth signal;
      // the row (if any) is left for its owner, per the bearer posture.
      log.error("api token died during refresh", {
        evt: "token.refresh.fail",
        reviewerId: String(session.reviewerId),
      });
      return {
        ok: false,
        error: {
          code: RefreshErrorCodes.REFRESH_FAILED,
          message: "refresh failed; re-authentication required",
        },
      };
    }
  }
  const principal: Mutable<ViewerPrincipal> = {
    ...session,
    ghTokenCiphertext: grant.ghTokenCiphertext,
    keyRef: grant.keyRef,
  };
  if (isCookie) {
    principal.expiresAt = grant.refreshExpiresAt;
  }

  if (rotatedAccessToken !== undefined) {
    return {
      ok: true,
      value: { session: principal, accessToken: rotatedAccessToken },
    };
  }

  // Short-circuit path (another request rotated under the lock): decrypt the
  // stored (fresh) access token to return. Unreadable → re-authentication
  // (cookie: session deleted; bearer: 401s until its owner revokes).
  const decryptedAccess = await decryptToken(
    deps.auth.keyProvider,
    grant.keyRef,
    grant.ghTokenCiphertext,
  );
  if (!decryptedAccess.ok) {
    return failChannel("stored grant credentials unreadable");
  }
  return {
    ok: true,
    value: { session: principal, accessToken: decryptedAccess.value },
  };
}
