// GitHub OAuth (user-to-server) login, mounted at `/api/auth/github`:
//   GET  /          → CSRF nonce cookie + 302 to GitHub
//   GET  /callback  → verify state, exchange code, create the encrypted
//                     session, set the session cookie
//
// On login the tenant derives from GitHub itself (`GET /user/installations`),
// never from a caller-supplied value.
//
// SECURITY DISCIPLINE (mirrors the webhook route): all query parsing via Zod;
// expected failures throw ApiError subclasses (sanitized bodies via
// `app.onError`); NO token, code, or secret
// is ever logged or placed in a response beyond the opaque session cookie.
import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import {
  buildAuthorizationUrl,
  createOAuthApp,
  exchangeWebFlowCode,
  fetchAuthenticatedUser,
  listAppInstallationsForUser,
  type GitHubOAuthApp,
} from "github";
import {
  encryptToken,
  createTenantRepository,
  createGrantAuth,
  createUserSettingsStore,
} from "persistence";
import { z } from "zod";
import { ApiErrorCode } from "../../error-response";
import {
  BadGateway,
  BadRequest,
  Forbidden,
  InternalError,
} from "../../shared-errors/api-error";
import { SESSION_COOKIE, sha256Hex, type AuthRouteDeps } from "./session";

const STATE_COOKIE = "rs_oauth_state";
/** Entropy for the CSRF state nonce and the session token (bytes). */
const STATE_BYTES = 32;
const SESSION_TOKEN_BYTES = 32;
/** The state cookie is short-lived — it only has to survive the round-trip. */
const STATE_TTL_SECONDS = 600;

const callbackQuerySchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});

/** Mountable oauth route; deps injected so tests pass a PGlite handle + stubs. */
export function oauthRoute(deps: AuthRouteDeps): Hono {
  const app = new Hono();
  const oauthApp: GitHubOAuthApp = createOAuthApp({
    clientId: deps.auth.oauthClientId,
    clientSecret: deps.auth.oauthClientSecret,
  });

  // Login: mint a CSRF state nonce, stash it in a short-lived cookie, and
  // redirect the reviewer to GitHub's authorization page.
  app.get("/", (c) => {
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
      redirectUrl: `${deps.auth.publicBaseUrl}/api/auth/github/callback`,
    });
    return c.redirect(url, 302);
  });

  // Callback: verify the CSRF state, exchange the code, resolve the reviewer +
  // tenant, seal both tokens, create the session, and set the session cookie.
  app.get("/callback", async (c) => {
    const stateCookie = getCookie(c, STATE_COOKIE);
    // The state nonce is single-use: clear it regardless of the outcome.
    deleteCookie(c, STATE_COOKIE, { path: "/" });

    const query = callbackQuerySchema.safeParse({
      code: c.req.query("code"),
      state: c.req.query("state"),
    });
    if (!query.success) {
      throw new BadRequest(ApiErrorCode.SIGN_IN_FAILED);
    }
    // CSRF: the returned state must match the cookie set on the login redirect.
    if (stateCookie === undefined || stateCookie !== query.data.state) {
      throw new BadRequest(ApiErrorCode.SIGN_IN_FAILED);
    }

    const tokens = await exchangeWebFlowCode(oauthApp, {
      code: query.data.code,
      state: query.data.state,
    });
    if (!tokens.ok) {
      throw new BadRequest(ApiErrorCode.SIGN_IN_FAILED);
    }

    // Independent of each other (both need only the access token) → run
    // concurrently to shave one GitHub round-trip off the login critical path.
    const [user, installations] = await Promise.all([
      fetchAuthenticatedUser(tokens.value.accessToken),
      listAppInstallationsForUser(tokens.value.accessToken),
    ]);
    if (!user.ok) {
      throw new BadGateway(ApiErrorCode.GITHUB_UNAVAILABLE);
    }
    if (!installations.ok) {
      throw new BadGateway(ApiErrorCode.GITHUB_UNAVAILABLE);
    }
    const accessible = installations.value;
    const firstAccessible = accessible[0];
    if (firstAccessible === undefined) {
      // No accessible installation → the app isn't installed where this
      // reviewer can reach it, so they aren't authorized to log in.
      throw new Forbidden(ApiErrorCode.APP_NOT_INSTALLED);
    }
    // Bind the session to the user's DEFAULT installation when it is still in
    // their LIVE accessible set, else the first accessible one. The default is
    // NEVER trusted as an id on its own — a dangling default degrades to the
    // first accessible installation rather than binding to something GitHub no
    // longer grants.
    const settings = await createUserSettingsStore(deps.handle).get(
      user.value.reviewerId,
    );
    const preferredDefault = settings?.defaultInstallationId ?? undefined;
    const installationId =
      preferredDefault !== undefined &&
      accessible.some((id) => id === preferredDefault)
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
      throw new InternalError(ApiErrorCode.INTERNAL_ERROR);
    }

    // The credential pair lands on a fresh grant row; the session LINKS it.
    // Session lifetime = refresh-token lifetime; access-token freshness is
    // handled by lazy refresh on a 401.
    const grants = createGrantAuth(deps.handle);
    const grant = await grants.createGrant({
      ghTokenCiphertext: sealedAccess.value,
      ghRefreshTokenCiphertext: sealedRefresh.value,
      keyRef: deps.auth.sessionKeyRef,
      refreshExpiresAt: tokens.value.refreshTokenExpiresAt,
    });
    try {
      await createTenantRepository(deps.handle, {
        installationId,
      }).sessions.create({
        sessionTokenHash,
        reviewerId: user.value.reviewerId,
        reviewerLogin: user.value.reviewerLogin,
        grantId: grant.id,
        expiresAt: tokens.value.refreshTokenExpiresAt,
      });
    } catch (error) {
      // Compensation: a grant that never gained its referent would linger
      // forever (lifecycle cleanup only runs on referent DELETE). Best-effort
      // — a failure here just leaves an inert, unreferenced ciphertext row.
      await grants.deleteIfOrphaned(grant.id).catch(() => undefined);
      throw error;
    }

    setCookie(c, SESSION_COOKIE, sessionToken, {
      httpOnly: true,
      sameSite: "Lax",
      secure: deps.auth.cookieSecure,
      path: "/",
    });
    return c.redirect("/", 302);
  });

  return app;
}
