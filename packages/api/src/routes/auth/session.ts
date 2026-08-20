// The shared reviewer-auth infrastructure: the session/principal shapes both
// presentation channels resolve into, plus the serialized token-refresh
// orchestrator (`refreshSessionToken`) the authz gate calls on a 401.
//
// TRUST SHAPE: a session cookie carries a high-entropy RANDOM token; the DB
// stores only its SHA-256 (globally unique). Session resolution PRECEDES tenant
// scoping — `sessionAuth(handle)` is not ctx-bound — so it is what tells us the
// installation.
//
// SECURITY DISCIPLINE: NO token, code, or secret is ever logged or placed in a
// response beyond the opaque session cookie. Tokens are sealed with
// `encryptToken` before they touch a row.
import { createHash } from "node:crypto";
import { createOAuthApp, refreshUserToken, type GitHubOAuthApp } from "github";
import {
  decryptToken,
  encryptToken,
  grantAuth,
  GrantAuthErrorCode,
  sessionAuth,
  tokenAuth,
  WriteClassification,
  type AppDatabase,
  type AuthSessionRow,
  type GithubGrantRow,
  type GrantRefreshPatch,
  type GrantRefreshRejection,
  type KeyProvider,
  type SessionWithGrant,
  type TokenWithGrant,
} from "persistence";
import type { Logger } from "logging";
import type { DraftPolicy, Result, ValueOf } from "types";

// ---------------------------------------------------------------------------
// Injected deps.
// ---------------------------------------------------------------------------

/**
 * The auth bundle injected into `createApp`. Credentials + crypto boundary + the
 * cookie/redirect policy — all supplied by the startup wiring, never read
 * from `process.env` here.
 */
export interface AuthDeps {
  readonly oauthClientId: string;
  readonly oauthClientSecret: string;
  /** Resolves `sessionKeyRef` → key bytes for token sealing (env→KMS boundary). */
  readonly keyProvider: KeyProvider;
  /** The env var NAME the session tokens seal under (e.g. `"SESSION_KEY_V1"`). */
  readonly sessionKeyRef: string;
  /** Public origin (scheme+host) the OAuth callback URL is built from. */
  readonly publicBaseUrl: string;
  /** `Secure` flag on issued cookies — true in any real (HTTPS) deployment. */
  readonly cookieSecure: boolean;
}

/** The slice of app deps the auth surface needs. `AppDeps` satisfies it. */
export interface AuthRouteDeps {
  readonly handle: AppDatabase;
  readonly auth: AuthDeps;
  /** Instance draft-PR policy; echoed on PR-meta for FE copy. */
  readonly draftPolicy?: DraftPolicy;
}

// ---------------------------------------------------------------------------
// Constants.
// ---------------------------------------------------------------------------

/**
 * The session cookie name. Exported so the authz middleware reads the SAME
 * cookie the oauth route sets, rather than re-declaring the string.
 */
export const SESSION_COOKIE = "rs_session";

/**
 * SHA-256 hex of a cookie token — the globally-unique DB key for a session.
 * Exported so the authz middleware hashes the incoming cookie identically.
 */
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

// ---------------------------------------------------------------------------
// The viewer principal — ONE shape for both presentation channels. A cookie
// session resolves to its row; a Bearer `mergebrief_...` token resolves through
// `tokenAuth` and is SYNTHESIZED into the same shape, so every gated route
// works unchanged on either channel. `channel` is what `refreshSessionToken`
// dispatches on — the ONLY behavioral fork.
// ---------------------------------------------------------------------------

export const AuthChannel = {
  COOKIE: "cookie",
  BEARER: "bearer",
} as const;
export type AuthChannel = ValueOf<typeof AuthChannel>;

/**
 * A resolved viewer. For `bearer`, `sessionTokenHash` carries the API token's
 * hash and `reviewerId`/`reviewerLogin` the minting user's — the field names
 * keep the session vocabulary so downstream cache keys, audit rows, and the
 * refresh CAS seed are channel-agnostic. `ghTokenCiphertext`/`keyRef` come
 * from the GRANT row at resolution (the referent rows carry no credential
 * material): the ciphertext doubles as the refresh CAS seed — the value
 * observed BEFORE a failing GitHub call.
 */
export type ViewerPrincipal = AuthSessionRow & {
  readonly channel: AuthChannel;
  readonly ghTokenCiphertext: string;
  readonly keyRef: string;
  /** What this credential may reach — the router's scope check reads it here. */
  readonly scope: WriteClassification;
};

/** Shape a resolved cookie session (+ its grant) into the principal. */
export function principalFromSession(
  resolved: SessionWithGrant,
): ViewerPrincipal {
  return {
    ...resolved.session,
    ghTokenCiphertext: resolved.grant.ghTokenCiphertext,
    keyRef: resolved.grant.keyRef,
    // A cookie has no row to hold a limit and the person is at the keyboard:
    // the browser is unlimited by construction, not by a stored value.
    scope: WriteClassification.EXTERNAL_WRITE,
    channel: AuthChannel.COOKIE,
  };
}

/**
 * Sentinel expiry for a no-expiry token's synthesized principal. The gate's
 * expiry decision already happened inside `tokenAuth.resolveByHash`; nothing
 * downstream reads `expiresAt` — this only satisfies the row shape.
 */
const NO_EXPIRY_SENTINEL = new Date(8_640_000_000_000_000);

/** Shape a resolved `api_token` (+ its grant) into the channel-agnostic principal. */
export function principalFromApiToken({
  token,
  grant,
}: TokenWithGrant): ViewerPrincipal {
  return {
    id: token.id,
    installationId: token.installationId,
    sessionTokenHash: token.tokenHash,
    reviewerId: token.userId,
    reviewerLogin: token.userLogin,
    grantId: token.grantId,
    ghTokenCiphertext: grant.ghTokenCiphertext,
    keyRef: grant.keyRef,
    expiresAt: token.expiresAt ?? NO_EXPIRY_SENTINEL,
    createdAt: token.createdAt,
    scope: token.scope,
    channel: AuthChannel.BEARER,
  };
}

// ---------------------------------------------------------------------------
// Refresh orchestrator — exported: the authz gate calls it on a 401.
// ---------------------------------------------------------------------------

export const RefreshErrorCode = {
  /** No session for the hash (already logged out / swept). */
  NOT_FOUND: "not-found",
  /** Refresh could not complete — the session was deleted; re-login required. */
  REFRESH_FAILED: "refresh-failed",
} as const;
export type RefreshErrorCode = ValueOf<typeof RefreshErrorCode>;

export interface RefreshError {
  readonly code: RefreshErrorCode;
  readonly message: string;
}

export interface RefreshedSession {
  readonly session: ViewerPrincipal;
  /** The fresh (or still-valid) decrypted user access token, for immediate use. */
  readonly accessToken: string;
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
 * Refresh the viewer's GitHub user access token — ONE orchestrator for both
 * presentation channels, anchored on the grant row. The caller passes the
 * principal it ALREADY resolved, so `principal.ghTokenCiphertext` is the
 * correct compare-and-swap seed: the ciphertext observed BEFORE the failing
 * GitHub call. `grantAuth.refreshGrant` takes the grant row lock and, if that
 * ciphertext no longer matches, another request (EITHER channel) already
 * rotated → the short-circuit returns the stored (now fresh) access token
 * WITHOUT a GitHub call (no double-spend of the single-use refresh token).
 *
 * Failure postures stay per-channel: cookie → delete the session and force
 * re-login; bearer → delete NOTHING (an api_token is a user-managed, listable
 * credential; a dead one keeps 401ing until its owner revokes or re-mints). On
 * cookie success the session's `expires_at` mirrors the grant's rotated
 * `refresh_expires_at` — including on the short-circuit path, because the
 * rotation may have been won by the Bearer channel, which never mirrors.
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
  const isCookie = session.channel === AuthChannel.COOKIE;

  // The one posture fork: cookie burns its session on any unrecoverable arm;
  // bearer leaves the row for its owner to see and revoke.
  const failChannel = async (
    message: string,
  ): Promise<Result<RefreshedSession, RefreshError>> => {
    if (isCookie) {
      await sessionAuth(deps.handle).deleteSession(session.sessionTokenHash);
    }
    log.error(isCookie ? `${message}; session deleted` : message, {
      evt: "token.refresh.fail",
      reviewerId: String(session.reviewerId),
    });
    return {
      ok: false,
      error: {
        code: RefreshErrorCode.REFRESH_FAILED,
        message: "refresh failed; re-authentication required",
      },
    };
  };

  // Captured from a successful GitHub rotation so we can return the plaintext
  // access token without re-decrypting what we just sealed.
  let rotatedAccessToken: string | undefined;

  const refreshed = await grantAuth(deps.handle).refreshGrant(
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
    if (refreshed.error.code === GrantAuthErrorCode.NOT_FOUND) {
      // The grant vanished under us — its last referent (this very row) was
      // deleted concurrently (logout / sweep / purge). Nothing to clean up;
      // the caller re-authenticates.
      return {
        ok: false,
        error: { code: RefreshErrorCode.NOT_FOUND, message: "grant not found" },
      };
    }
    // REFRESH_REJECTED: decrypt / GitHub rotation / re-encrypt failed.
    return failChannel("grant refresh failed");
  }

  const grant = refreshed.value;
  // Re-verify the REFERENT after the rotation: the grant lock does not see
  // session/token state, so a referent that died mid-request — logout, sweep,
  // owner revoke — must not receive the fresh token. The rotation itself
  // stands either way (it benefits the grant's surviving referents).
  if (isCookie) {
    // The expiry mirror doubles as the liveness check: 0 rows touched means
    // the session vanished while we rotated → re-login, nothing to delete.
    const touched = await sessionAuth(deps.handle).setExpiresAt(
      session.sessionTokenHash,
      grant.refreshExpiresAt,
    );
    if (touched === 0) {
      return {
        ok: false,
        error: {
          code: RefreshErrorCode.NOT_FOUND,
          message: "session not found",
        },
      };
    }
  } else {
    const live = await tokenAuth(deps.handle).resolveByHash(
      session.sessionTokenHash,
      new Date(),
    );
    if (!live.ok) {
      // Revoked/expired/deleted mid-request — same hint-free re-auth signal;
      // the row (if any) is left for its owner, per the bearer posture.
      log.error("api token died during refresh", {
        evt: "token.refresh.fail",
        reviewerId: String(session.reviewerId),
      });
      return {
        ok: false,
        error: {
          code: RefreshErrorCode.REFRESH_FAILED,
          message: "refresh failed; re-authentication required",
        },
      };
    }
  }
  const principal: ViewerPrincipal = {
    ...session,
    ghTokenCiphertext: grant.ghTokenCiphertext,
    keyRef: grant.keyRef,
    ...(isCookie ? { expiresAt: grant.refreshExpiresAt } : {}),
  };

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
