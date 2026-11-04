// The serialized token-refresh orchestrator the authz gate calls on a 401,
// ONE for both presentation channels, anchored on the grant row. Tokens are
// sealed with `encryptToken` before they touch a row; nothing here logs one.
// GitHub is called under the grant's row lock, bounded by the OAuth request
// timeout; nothing but the two seals runs between its answer and the UPDATE.
import {
  createOAuthApp,
  deleteUserToken,
  OAuthErrorCodes,
  refreshUserToken,
  type GitHubOAuthApp,
  type OAuthError,
} from "github";
import {
  decryptToken,
  encryptToken,
  createGrantAuth,
  GrantAuthErrorCodes,
  GrantSealedColumns,
  createSessionAuth,
  createTokenAuth,
  type GithubGrantRow,
  type GrantRefreshPatch,
} from "persistence";
import type { Logger } from "logging";
import type { Mutable, Result } from "types";
import {
  checkTokenAccess,
  namesAnyone,
} from "../../../../access/instance-access";
import { TokenAccessFailures } from "../../../../access/types";
import {
  AuthChannels,
  RefreshErrorCodes,
  RotationFailures,
  type AuthRouteDeps,
  type RefreshError,
  type RefreshedSession,
  type RotationFailure,
  type RotationRejection,
  type ViewerPrincipal,
} from "../types";
import { answerRotationFailure } from "./refresh-failure";

interface RotatedTokens {
  readonly patch: GrantRefreshPatch;
  readonly accessToken: string;
}

function rejectRotation(
  reason: RotationFailure,
): Result<never, RotationRejection> {
  return { ok: false, error: { reason } };
}

/**
 * Only GitHub refusing the refresh token itself means the reviewer's grant is
 * gone; a refusal of the App's credentials or settings is the operator's.
 */
function classifyGitHubRefusal(
  error: OAuthError,
): Result<never, RotationRejection> {
  switch (error.code) {
    case OAuthErrorCodes.REFRESH_UNAVAILABLE: {
      return rejectRotation(RotationFailures.GITHUB_UNAVAILABLE);
    }
    case OAuthErrorCodes.REFRESH_TOKEN_REJECTED: {
      return rejectRotation(RotationFailures.GITHUB_REJECTED);
    }
    case OAuthErrorCodes.EXPIRATION_NOT_ENABLED: {
      return {
        ok: false,
        error: {
          reason: RotationFailures.CLIENT_MISCONFIGURED,
          clientError: OAuthErrorCodes.EXPIRATION_NOT_ENABLED,
        },
      };
    }
    default: {
      return {
        ok: false,
        error: {
          reason: RotationFailures.CLIENT_MISCONFIGURED,
          clientError: error.oauthError ?? error.code,
        },
      };
    }
  }
}

/**
 * The GitHub rotation shared by both channels: decrypt the stored refresh
 * token, exchange it, seal the rotated pair. Returns the grant patch plus the
 * rotated plaintext access token for immediate use.
 */
async function rotateGitHubTokens(
  deps: AuthRouteDeps,
  oauthApp: GitHubOAuthApp,
  locked: GithubGrantRow,
): Promise<Result<RotatedTokens, RotationRejection>> {
  const decryptedRefresh = await decryptToken(
    deps.auth.keyProvider,
    locked.keyRef,
    locked.ghRefreshTokenCiphertext,
    { grantId: locked.id, column: GrantSealedColumns.REFRESH_TOKEN },
  );
  if (!decryptedRefresh.ok) {
    return rejectRotation(RotationFailures.DECRYPT_FAILED);
  }
  const tokens = await refreshUserToken(oauthApp, {
    refreshToken: decryptedRefresh.value,
  });
  if (!tokens.ok) {
    return classifyGitHubRefusal(tokens.error);
  }
  const sealedAccess = await encryptToken(
    deps.auth.keyProvider,
    deps.auth.sessionKeyRef,
    tokens.value.accessToken,
    { grantId: locked.id, column: GrantSealedColumns.ACCESS_TOKEN },
  );
  const sealedRefresh = await encryptToken(
    deps.auth.keyProvider,
    deps.auth.sessionKeyRef,
    tokens.value.refreshToken,
    { grantId: locked.id, column: GrantSealedColumns.REFRESH_TOKEN },
  );
  if (!sealedAccess.ok || !sealedRefresh.ok) {
    return rejectRotation(RotationFailures.SEAL_FAILED);
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
 * The grant lock does not see session or token state, so a referent that
 * died mid-request (logout, sweep, owner revoke) must not receive the fresh
 * token. The cookie's expiry mirror doubles as its liveness check.
 */
async function confirmReferentLive(
  deps: AuthRouteDeps,
  session: ViewerPrincipal,
  grant: GithubGrantRow,
  log: Logger,
): Promise<RefreshError | undefined> {
  if (session.channel === AuthChannels.COOKIE) {
    const touched = await createSessionAuth(deps.handle).setExpiresAt(
      session.sessionTokenHash,
      grant.refreshExpiresAt,
    );
    if (touched === 0) {
      return {
        code: RefreshErrorCodes.NOT_FOUND,
        message: "session not found",
      };
    }
    return undefined;
  }
  const live = await createTokenAuth(deps.handle).resolveByHash(
    session.sessionTokenHash,
    new Date(),
  );
  if (live !== undefined) {
    return undefined;
  }
  // The row, if any, is left for its owner, per the bearer posture.
  log.error("api token died during refresh", {
    evt: "token.refresh.fail",
    reviewerId: String(session.reviewerId),
  });
  return {
    code: RefreshErrorCodes.REFRESH_FAILED,
    message: "refresh failed; re-authentication required",
  };
}

/**
 * A rotation re-asks who may use the instance, so removing someone ends their
 * sessions and API tokens by their next rotation. Retiring cannot be undone, so
 * an unanswered read or a config naming nobody keeps them.
 */
async function refuseUnlistedRotation(
  deps: AuthRouteDeps,
  oauthApp: GitHubOAuthApp,
  session: ViewerPrincipal,
  accessToken: string,
  log: Logger,
): Promise<RefreshError | undefined> {
  if (!namesAnyone(deps)) {
    log.error(
      "the instance config names nobody; check MERGEBRIEF_CONFIG. Sign-in and new briefs stay refused, and no session or token was ended",
    );
    return undefined;
  }
  const allowed = await checkTokenAccess(deps, accessToken, session.reviewerId);
  if (allowed.ok || allowed.error === TokenAccessFailures.UNAVAILABLE) {
    return undefined;
  }

  await createGrantAuth(deps.handle).retireGrant(session.grantId, new Date());
  log.info("grant retired: the account is no longer allowed on this instance", {
    reviewerId: String(session.reviewerId),
  });
  const revoked = await deleteUserToken(oauthApp, { accessToken });
  if (!revoked.ok) {
    log.warn("GitHub did not revoke a retired grant's token", {
      evt: "grant.revoke.fail",
      code: revoked.error.code,
    });
  }
  return {
    code: RefreshErrorCodes.GRANT_DEAD,
    message: "the account is not allowed on this instance",
  };
}

/**
 * ONE refresh orchestrator for both channels, anchored on the grant row. The
 * caller passes the principal it ALREADY held when GitHub 401ed, never a
 * re-resolved one: its `ghTokenCiphertext` is the compare-and-swap seed. If it
 * no longer matches under the grant lock, another request already rotated and
 * the stored token is returned without a GitHub call (the refresh token is
 * single-use). On cookie success `expires_at` mirrors the grant's
 * `refresh_expires_at`, also on the short-circuit path, since the bearer
 * channel never mirrors.
 */
export async function refreshSessionToken(
  deps: AuthRouteDeps,
  session: ViewerPrincipal,
  log: Logger,
): Promise<Result<RefreshedSession, RefreshError>> {
  const oauthApp = createOAuthApp({
    clientId: deps.auth.oauthClientId,
    clientSecret: deps.auth.oauthClientSecret,
    requestTimeoutMs: deps.auth.oauthRequestTimeoutMs,
  });
  let rotatedAccessToken: string | undefined;
  let rotationFailure: RotationRejection | undefined;

  const refreshed = await createGrantAuth(deps.handle).refreshGrant(
    session.grantId,
    session.ghTokenCiphertext,
    async (locked) => {
      const rotated = await rotateGitHubTokens(deps, oauthApp, locked);
      if (!rotated.ok) {
        rotationFailure = rotated.error;
        return rotated;
      }
      rotatedAccessToken = rotated.value.accessToken;
      return { ok: true, value: rotated.value.patch };
    },
  );

  if (!refreshed.ok) {
    // The grant's last referent was deleted concurrently; nothing to clean up.
    if (refreshed.error.code === GrantAuthErrorCodes.NOT_FOUND) {
      return {
        ok: false,
        error: {
          code: RefreshErrorCodes.NOT_FOUND,
          message: "grant not found",
        },
      };
    }
    if (refreshed.error.code === GrantAuthErrorCodes.LOCK_TIMEOUT) {
      return answerRotationFailure(
        deps,
        session,
        { reason: RotationFailures.GRANT_BUSY },
        log,
      );
    }
    if (rotationFailure === undefined) {
      throw new Error("grant refresh rejected without a rotation failure");
    }
    return answerRotationFailure(deps, session, rotationFailure, log);
  }

  const grant = refreshed.value;
  const referentError = await confirmReferentLive(deps, session, grant, log);
  if (referentError !== undefined) {
    return { ok: false, error: referentError };
  }
  const principal: Mutable<ViewerPrincipal> = {
    ...session,
    ghTokenCiphertext: grant.ghTokenCiphertext,
    keyRef: grant.keyRef,
  };
  if (session.channel === AuthChannels.COOKIE) {
    principal.expiresAt = grant.refreshExpiresAt;
  }

  if (rotatedAccessToken !== undefined) {
    const refused = await refuseUnlistedRotation(
      deps,
      oauthApp,
      session,
      rotatedAccessToken,
      log,
    );
    if (refused !== undefined) {
      return { ok: false, error: refused };
    }
    return {
      ok: true,
      value: { session: principal, accessToken: rotatedAccessToken },
    };
  }

  // Short-circuit path: another request rotated under the lock.
  const decryptedAccess = await decryptToken(
    deps.auth.keyProvider,
    grant.keyRef,
    grant.ghTokenCiphertext,
    { grantId: grant.id, column: GrantSealedColumns.ACCESS_TOKEN },
  );
  if (!decryptedAccess.ok) {
    return answerRotationFailure(
      deps,
      session,
      { reason: RotationFailures.DECRYPT_FAILED },
      log,
    );
  }
  return {
    ok: true,
    value: { session: principal, accessToken: decryptedAccess.value },
  };
}
