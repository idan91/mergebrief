// Reviewer authentication routes (BRIEF-2 stage 6, PR C — ADR 0016 #4 + ADR
// 0018 D11, plan decision #3). GitHub OAuth (user-to-server) login:
//   GET  /auth/github          → CSRF nonce cookie + 302 to GitHub
//   GET  /auth/github/callback → verify state, exchange code, create the
//                                encrypted session, set the session cookie
//   POST /auth/logout          → delete the session + clear the cookie
// plus the serialized token-refresh orchestrator (`refreshSessionToken`) that
// stage 7 calls on a 401 — built and tested here.
//
// TRUST SHAPE: a session cookie carries a high-entropy RANDOM token; the DB
// stores only its SHA-256 (globally unique). Session resolution PRECEDES tenant
// scoping — `sessionAuth(handle)` is not ctx-bound — so it is what tells us the
// installation. On login we derive the tenant from GitHub itself
// (`GET /user/installations`), never from a caller-supplied value.
//
// SECURITY DISCIPLINE (mirrors the webhook route): all query/body parsing via
// Zod; expected failures return sanitized status bodies; NO token, code, or
// secret is ever logged or placed in a response beyond the opaque session
// cookie. Tokens are sealed with `encryptToken` before they touch a row.
import { createHash, randomBytes } from "node:crypto";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import {
  buildAuthorizationUrl,
  createOAuthApp,
  exchangeWebFlowCode,
  fetchAuthenticatedUser,
  listAppInstallationsForUser,
  refreshUserToken,
  type GitHubOAuthApp,
} from "github";
import {
  decryptToken,
  encryptToken,
  forTenant,
  sessionAuth,
  SessionAuthErrorCode,
  tokenAuth,
  TokenAuthErrorCode,
  userSettingsStore,
  type ApiTokenRow,
  type AppDatabase,
  type KeyProvider,
  type ReviewerSessionRow,
  type TokenRefreshPatch,
  type TokenRefreshRejection,
} from "persistence";
import type { DraftPolicy, Result, ValueOf } from "types";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Injected deps.
// ---------------------------------------------------------------------------

/**
 * The auth bundle injected into `createApp`. Credentials + crypto seam + the
 * cookie/redirect policy — all supplied by the composition root, never read
 * from `process.env` here.
 */
export interface AuthDeps {
  readonly oauthClientId: string;
  readonly oauthClientSecret: string;
  /** Resolves `sessionKeyRef` → key bytes for token sealing (env→KMS seam). */
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
  /** Instance draft-PR policy (BRIEF-64); echoed on PR-meta for FE copy. */
  readonly draftPolicy?: DraftPolicy;
}

// ---------------------------------------------------------------------------
// Constants.
// ---------------------------------------------------------------------------

const STATE_COOKIE = "rs_oauth_state";
/**
 * The session cookie name. Exported so the stage-7 authz middleware reads the
 * SAME cookie this route sets, rather than re-declaring the string.
 */
export const SESSION_COOKIE = "rs_session";
/** Entropy for the CSRF state nonce and the session token (bytes). */
const STATE_BYTES = 32;
const SESSION_TOKEN_BYTES = 32;
/** The state cookie is short-lived — it only has to survive the round-trip. */
const STATE_TTL_SECONDS = 600;

/**
 * SHA-256 hex of a cookie token — the globally-unique DB key for a session.
 * Exported so the authz middleware hashes the incoming cookie identically.
 */
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

// ---------------------------------------------------------------------------
// The viewer principal — ONE shape for both presentation channels (ADR 0016
// #4 as amended, BRIEF-17). A cookie session resolves to its row; a Bearer
// `mergebrief_...` token resolves through `tokenAuth` and is SYNTHESIZED into
// the same shape, so every gated route (repo gate, pulls list, submit,
// conversation, diff) works unchanged on either channel. `channel` is what
// `refreshSessionToken` dispatches on — the ONLY behavioral fork.
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
 * refresh CAS seed are channel-agnostic.
 */
export type ViewerPrincipal = ReviewerSessionRow & { readonly channel: AuthChannel };

/**
 * Sentinel expiry for a no-expiry token's synthesized principal. The gate's
 * expiry decision already happened inside `tokenAuth.resolveByHash`; nothing
 * downstream reads `expiresAt` — this only satisfies the row shape.
 */
const NO_EXPIRY_SENTINEL = new Date(8_640_000_000_000_000);

/** Shape an `api_token` row into the channel-agnostic principal. */
export function principalFromApiToken(row: ApiTokenRow): ViewerPrincipal {
  return {
    id: row.id,
    installationId: row.installationId,
    sessionTokenHash: row.tokenHash,
    reviewerId: row.userId,
    reviewerLogin: row.userLogin,
    ghTokenCiphertext: row.ghTokenCiphertext,
    ghRefreshTokenCiphertext: row.ghRefreshTokenCiphertext,
    keyRef: row.keyRef,
    expiresAt: row.expiresAt ?? NO_EXPIRY_SENTINEL,
    createdAt: row.createdAt,
    channel: AuthChannel.BEARER,
  };
}

// ---------------------------------------------------------------------------
// Refresh orchestrator (exported: used by the logout-adjacent flows here and by
// stage 7's authz middleware on a 401).
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
 * token, exchange it, seal the rotated pair. Returns the session-shaped patch
 * (the superset — token refresh drops `expiresAt`, see the dispatch) plus the
 * rotated plaintext access token for immediate use.
 */
async function rotateGitHubTokens(
  deps: AuthRouteDeps,
  oauthApp: GitHubOAuthApp,
  locked: { readonly keyRef: string; readonly ghRefreshTokenCiphertext: string },
): Promise<
  Result<
    { patch: SessionRefreshPatchShape; accessToken: string },
    { reason: string }
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
        expiresAt: tokens.value.refreshTokenExpiresAt,
      },
      accessToken: tokens.value.accessToken,
    },
  };
}

interface SessionRefreshPatchShape {
  readonly ghTokenCiphertext: string;
  readonly ghRefreshTokenCiphertext: string;
  readonly keyRef: string;
  readonly expiresAt: Date;
}

/**
 * Bearer-channel refresh: the same serialized CAS shape over `api_token`
 * (`tokenAuth.refreshToken`), with two deliberate differences from the cookie
 * flow: the patch NEVER carries `expiresAt` (a token's expiry is mint-chosen,
 * independent of GitHub rotation), and NOTHING is deleted on failure — an
 * api_token is a user-managed, listable credential; a dead one keeps 401ing
 * until its owner revokes or re-mints, it is never silently removed.
 */
async function refreshApiTokenCredentials(
  deps: AuthRouteDeps,
  principal: ViewerPrincipal,
  oauthApp: GitHubOAuthApp,
): Promise<Result<RefreshedSession, RefreshError>> {
  let rotatedAccessToken: string | undefined;

  const refreshed = await tokenAuth(deps.handle).refreshToken(
    principal.sessionTokenHash,
    principal.ghTokenCiphertext,
    new Date(),
    async (locked): Promise<Result<TokenRefreshPatch, TokenRefreshRejection>> => {
      const rotated = await rotateGitHubTokens(deps, oauthApp, locked);
      if (!rotated.ok) {
        return rotated;
      }
      rotatedAccessToken = rotated.value.accessToken;
      const { ghTokenCiphertext, ghRefreshTokenCiphertext, keyRef } = rotated.value.patch;
      return { ok: true, value: { ghTokenCiphertext, ghRefreshTokenCiphertext, keyRef } };
    },
  );

  if (!refreshed.ok) {
    if (refreshed.error.code === TokenAuthErrorCode.NOT_FOUND) {
      return {
        ok: false,
        error: { code: RefreshErrorCode.NOT_FOUND, message: "api token not found" },
      };
    }
    // REVOKED / EXPIRED / REFRESH_REJECTED — all collapse to the same
    // re-authenticate signal; the row is left for its owner to see and revoke.
    return {
      ok: false,
      error: {
        code: RefreshErrorCode.REFRESH_FAILED,
        message: "api token refresh failed",
      },
    };
  }

  if (rotatedAccessToken !== undefined) {
    return {
      ok: true,
      value: { session: principalFromApiToken(refreshed.value), accessToken: rotatedAccessToken },
    };
  }

  // CAS short-circuit: another request rotated under the lock — decrypt the
  // stored (fresh) access token to return.
  const decryptedAccess = await decryptToken(
    deps.auth.keyProvider,
    refreshed.value.keyRef,
    refreshed.value.ghTokenCiphertext,
  );
  if (!decryptedAccess.ok) {
    return {
      ok: false,
      error: {
        code: RefreshErrorCode.REFRESH_FAILED,
        message: "stored api token credentials unreadable",
      },
    };
  }
  return {
    ok: true,
    value: {
      session: principalFromApiToken(refreshed.value),
      accessToken: decryptedAccess.value,
    },
  };
}

/**
 * Refresh a session's user access token, serialized per session (D11). The
 * caller passes the session row it ALREADY read (the stage-7 middleware read it
 * to get the token that just 401'd) — so there is no redundant lookup here, and
 * `session.ghTokenCiphertext` is the correct compare-and-swap seed: it is the
 * ciphertext observed BEFORE the failing GitHub call. `sessionAuth.refreshSession`
 * takes the row lock and, if that ciphertext no longer matches, another request
 * already rotated the tokens → the short-circuit returns the stored (now fresh)
 * access token, decrypted, WITHOUT a GitHub call (no double-spend of the
 * single-use refresh token). Otherwise it decrypts the stored refresh token,
 * calls GitHub `refreshUserToken`, re-encrypts BOTH rotated tokens, and applies
 * the patch (session lifetime tracks the new refresh-token expiry). A vanished
 * row → `NOT_FOUND`; any decrypt / GitHub / re-encrypt failure deletes the
 * session and returns `REFRESH_FAILED` (both signal re-login).
 */
export async function refreshSessionToken(
  deps: AuthRouteDeps,
  session: ViewerPrincipal,
): Promise<Result<RefreshedSession, RefreshError>> {
  const oauthApp = createOAuthApp({
    clientId: deps.auth.oauthClientId,
    clientSecret: deps.auth.oauthClientSecret,
  });

  // The ONE channel fork (BRIEF-17): a Bearer principal refreshes its
  // api_token row; everything below is the cookie-session flow.
  if (session.channel === AuthChannel.BEARER) {
    return refreshApiTokenCredentials(deps, session, oauthApp);
  }

  const auth = sessionAuth(deps.handle);
  const sessionTokenHash = session.sessionTokenHash;

  // Captured from a successful GitHub rotation so we can return the plaintext
  // access token without re-decrypting what we just sealed.
  let rotatedAccessToken: string | undefined;

  const refreshed = await auth.refreshSession(
    sessionTokenHash,
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
    if (refreshed.error.code === SessionAuthErrorCode.NOT_FOUND) {
      // The row vanished between the caller's read and the lock (logout / sweep).
      // Nothing to delete; the caller re-logs in.
      return {
        ok: false,
        error: { code: RefreshErrorCode.NOT_FOUND, message: "session not found" },
      };
    }
    // REFRESH_REJECTED: burn the session so the reviewer is bounced to re-login.
    await auth.deleteSession(sessionTokenHash);
    return {
      ok: false,
      error: {
        code: RefreshErrorCode.REFRESH_FAILED,
        message: "session refresh failed; re-login required",
      },
    };
  }

  if (rotatedAccessToken !== undefined) {
    return {
      ok: true,
      value: {
        session: { ...refreshed.value, channel: AuthChannel.COOKIE },
        accessToken: rotatedAccessToken,
      },
    };
  }

  // Short-circuit path (another request refreshed it under the lock): decrypt
  // the stored access token to return. An unreadable token forces re-login.
  const decryptedAccess = await decryptToken(
    deps.auth.keyProvider,
    refreshed.value.keyRef,
    refreshed.value.ghTokenCiphertext,
  );
  if (!decryptedAccess.ok) {
    await auth.deleteSession(sessionTokenHash);
    return {
      ok: false,
      error: {
        code: RefreshErrorCode.REFRESH_FAILED,
        message: "stored session token unreadable; re-login required",
      },
    };
  }
  return {
    ok: true,
    value: {
      session: { ...refreshed.value, channel: AuthChannel.COOKIE },
      accessToken: decryptedAccess.value,
    },
  };
}

// ---------------------------------------------------------------------------
// Routes.
// ---------------------------------------------------------------------------

const callbackQuerySchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});

/** Mountable auth route; deps injected so tests pass a PGlite handle + stubs. */
export function authRoute(deps: AuthRouteDeps): Hono {
  const app = new Hono();
  const oauthApp: GitHubOAuthApp = createOAuthApp({
    clientId: deps.auth.oauthClientId,
    clientSecret: deps.auth.oauthClientSecret,
  });

  // Login: mint a CSRF state nonce, stash it in a short-lived cookie, and
  // redirect the reviewer to GitHub's authorization page.
  app.get("/auth/github", (c) => {
    const state = randomBytes(STATE_BYTES).toString("base64url");
    setCookie(c, STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: "Lax",
      secure: deps.auth.cookieSecure,
      path: "/",
      maxAge: STATE_TTL_SECONDS,
    });
    const { url } = buildAuthorizationUrl(oauthApp, {
      state,
      redirectUrl: `${deps.auth.publicBaseUrl}/auth/github/callback`,
    });
    return c.redirect(url, 302);
  });

  // Callback: verify the CSRF state, exchange the code, resolve the reviewer +
  // tenant, seal both tokens, create the session, and set the session cookie.
  app.get("/auth/github/callback", async (c) => {
    const stateCookie = getCookie(c, STATE_COOKIE);
    // The state nonce is single-use: clear it regardless of the outcome.
    deleteCookie(c, STATE_COOKIE, { path: "/" });

    const query = callbackQuerySchema.safeParse({
      code: c.req.query("code"),
      state: c.req.query("state"),
    });
    if (!query.success) {
      return c.json({ error: "invalid callback parameters" }, 400);
    }
    // CSRF: the returned state must match the cookie we set at /auth/github.
    if (stateCookie === undefined || stateCookie !== query.data.state) {
      return c.json({ error: "invalid oauth state" }, 400);
    }

    const tokens = await exchangeWebFlowCode(oauthApp, {
      code: query.data.code,
      state: query.data.state,
    });
    if (!tokens.ok) {
      return c.json({ error: "oauth code exchange failed" }, 400);
    }

    // Independent of each other (both need only the access token) → run
    // concurrently to shave one GitHub round-trip off the login critical path.
    const [user, installations] = await Promise.all([
      fetchAuthenticatedUser(tokens.value.accessToken),
      listAppInstallationsForUser(tokens.value.accessToken),
    ]);
    if (!user.ok) {
      return c.json({ error: "could not resolve the authenticated user" }, 502);
    }
    if (!installations.ok) {
      return c.json({ error: "could not resolve app installations" }, 502);
    }
    const accessible = installations.value;
    const firstAccessible = accessible[0];
    if (firstAccessible === undefined) {
      // No accessible installation → the app isn't installed where this
      // reviewer can reach it, so they aren't authorized to log in.
      return c.json({ error: "the app is not installed for this account" }, 403);
    }
    // BRIEF-19 (D14): bind the session to the user's DEFAULT installation when
    // it is still in their LIVE accessible set, else the first accessible one.
    // The default is a cross-session per-user setting (user_settings), and it
    // is NEVER trusted as an id on its own — a dangling default (installation
    // purged/uninstalled since it was set) degrades to the first accessible
    // installation rather than binding to something GitHub no longer grants.
    const settings = await userSettingsStore(deps.handle).get(user.value.reviewerId);
    const preferredDefault = settings?.defaultInstallationId ?? undefined;
    const installationId =
      preferredDefault !== undefined && accessible.some((id) => id === preferredDefault)
        ? preferredDefault
        : firstAccessible;

    const sessionToken = randomBytes(SESSION_TOKEN_BYTES).toString("base64url");
    const sessionTokenHash = sha256Hex(sessionToken);

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
      return c.json({ error: "could not persist the session" }, 500);
    }

    // Session lifetime = refresh-token lifetime; access-token freshness is
    // handled by lazy refresh (`refreshSessionToken`, wired on a 401 in stage 7).
    await forTenant(deps.handle, { installationId }).sessions.create({
      sessionTokenHash,
      reviewerId: user.value.reviewerId,
      reviewerLogin: user.value.reviewerLogin,
      ghTokenCiphertext: sealedAccess.value,
      ghRefreshTokenCiphertext: sealedRefresh.value,
      keyRef: deps.auth.sessionKeyRef,
      expiresAt: tokens.value.refreshTokenExpiresAt,
    });

    setCookie(c, SESSION_COOKIE, sessionToken, {
      httpOnly: true,
      sameSite: "Lax",
      secure: deps.auth.cookieSecure,
      path: "/",
    });
    return c.redirect("/", 302);
  });

  // Logout: delete the session row (if any) and clear the cookie.
  app.post("/auth/logout", async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token !== undefined) {
      await sessionAuth(deps.handle).deleteSession(sha256Hex(token));
    }
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ ok: true }, 200);
  });

  return app;
}
