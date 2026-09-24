// GitHub user-to-server OAuth login. The entry sets a CSRF nonce cookie and
// redirects to GitHub; the callback verifies state, exchanges the code and
// sets the session cookie. The session names the reviewer and nothing else:
// every request resolves the tenant from its repository against GitHub.
//
// SECURITY DISCIPLINE, mirroring the webhook route: Zod parses every query,
// expected failures throw ApiError subclasses, and NO token or secret is ever
// logged or placed in a response BODY. Both cookies are httpOnly `__Host-`
// cookies; the state nonce also rides the Location, which is what state is.
import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import {
  buildAuthorizationUrl,
  createOAuthApp,
  exchangeWebFlowCode,
  fetchAuthenticatedUser,
  type GitHubOAuthApp,
} from "github";
import {
  encryptToken,
  createTenantRepository,
  createGrantAuth,
} from "persistence";
import { z } from "zod";
import { ApiErrorCodes } from "contract";
import {
  BadGateway,
  BadRequest,
  InternalError,
} from "../../shared-errors/api-error";
import type { AuthRouteDeps } from "./session/types";
import {
  HOST_COOKIE_ATTRIBUTES,
  HOST_COOKIE_CLEAR,
  SESSION_COOKIE,
} from "./session/consts";
import { sha256Hex } from "./session/utils";

const STATE_COOKIE = "__Host-mergebrief_oauth_state";
/** Entropy for the CSRF state nonce and the session token (bytes). */
const STATE_BYTES = 32;
const SESSION_TOKEN_BYTES = 32;
/** The state cookie is short-lived, it only has to survive the round-trip. */
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
      ...HOST_COOKIE_ATTRIBUTES,
      maxAge: STATE_TTL_SECONDS,
    });
    const { url } = buildAuthorizationUrl(oauthApp, {
      state,
      redirectUrl: `${deps.auth.publicBaseUrl}/api/auth/github/callback`,
    });
    return c.redirect(url, 302);
  });

  // Callback: verify the CSRF state, exchange the code, resolve the reviewer,
  // seal both tokens, create the session, and set the session cookie.
  app.get("/callback", async (c) => {
    const stateCookie = getCookie(c, STATE_COOKIE);
    // The state nonce is single-use: clear it regardless of the outcome.
    deleteCookie(c, STATE_COOKIE, HOST_COOKIE_CLEAR);

    const query = callbackQuerySchema.safeParse({
      code: c.req.query("code"),
      state: c.req.query("state"),
    });
    if (!query.success) {
      throw new BadRequest(ApiErrorCodes.SIGN_IN_FAILED);
    }
    // CSRF: the returned state must match the cookie set on the login redirect.
    if (stateCookie === undefined || stateCookie !== query.data.state) {
      throw new BadRequest(ApiErrorCodes.SIGN_IN_FAILED);
    }

    const tokens = await exchangeWebFlowCode(oauthApp, {
      code: query.data.code,
      state: query.data.state,
    });
    if (!tokens.ok) {
      throw new BadRequest(ApiErrorCodes.SIGN_IN_FAILED);
    }

    const user = await fetchAuthenticatedUser(tokens.value.accessToken);
    if (!user.ok) {
      throw new BadGateway(ApiErrorCodes.GITHUB_UNAVAILABLE);
    }

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
      throw new InternalError();
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
        ownerUserId: user.value.reviewerId,
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
      // a failure here just leaves an inert, unreferenced ciphertext row.
      await grants.deleteIfOrphaned(grant.id).catch(() => undefined);
      throw error;
    }

    setCookie(c, SESSION_COOKIE, sessionToken, HOST_COOKIE_ATTRIBUTES);
    return c.redirect("/", 302);
  });

  return app;
}
