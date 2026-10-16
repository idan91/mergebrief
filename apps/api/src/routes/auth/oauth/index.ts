// GitHub user-to-server OAuth login. The entry sets a CSRF nonce cookie and
// redirects to GitHub; the callback verifies state, exchanges the code and
// sets the session cookie, which names the reviewer and nothing else.
//
// The callback is a browser navigation: every failure redirects home with
// `SIGN_IN_FAILURE_PARAM`, never an error body. Both cookies are httpOnly
// `__Host-` cookies; the state nonce also rides the Location.
import { randomBytes } from "node:crypto";
import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { buildAuthorizationUrl, createOAuthApp } from "github";
import { z } from "zod/v4";
import {
  SIGN_IN_FAILURE_PARAM,
  SignInFailures,
  type SignInFailure,
} from "contract";
import type { AuthzEnv } from "../../../access/types";
import type { AuthRouteDeps } from "../session/types";
import {
  HOST_COOKIE_ATTRIBUTES,
  HOST_COOKIE_CLEAR,
  SESSION_COOKIE,
} from "../session/consts";
import { completeSignIn } from "./complete-sign-in";
import { HttpStatuses } from "types/http";

const STATE_COOKIE = "__Host-mergebrief_oauth_state";
/** Entropy for the CSRF state nonce (bytes). */
const STATE_BYTES = 32;
/** What a minted state measures once base64url-encoded. */
const STATE_LENGTH = Buffer.alloc(STATE_BYTES).toString("base64url").length;
/** The state cookie is short-lived, it only has to survive the round-trip. */
const STATE_TTL_SECONDS = 600;
/** GitHub's callback `error` when the user cancels on the consent page. */
const ACCESS_DENIED = "access_denied";

const stateSchema = z.base64url().length(STATE_LENGTH);

const callbackQuerySchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});

/** Mountable oauth route; deps injected so tests pass a PGlite handle + stubs. */
export function oauthRoute(deps: AuthRouteDeps): Hono<AuthzEnv> {
  const app = new Hono<AuthzEnv>();
  const oauthApp = createOAuthApp({
    clientId: deps.auth.oauthClientId,
    clientSecret: deps.auth.oauthClientSecret,
  });

  // The host holds one state cookie, so a start while another tab's flow is
  // in flight reuses its state. The first tab back signs in; the other finds
  // the state spent and lands on a signed-in Home. The TTL restarts so the
  // later tab gets the full round-trip.
  app.get("/", (c) => {
    const inFlight = stateSchema.safeParse(getCookie(c, STATE_COOKIE));
    let state = randomBytes(STATE_BYTES).toString("base64url");
    if (inFlight.success) {
      state = inFlight.data;
    }

    setCookie(c, STATE_COOKIE, state, {
      ...HOST_COOKIE_ATTRIBUTES,
      maxAge: STATE_TTL_SECONDS,
    });
    const { url } = buildAuthorizationUrl(oauthApp, {
      state,
      redirectUrl: `${deps.auth.publicBaseUrl}/api/auth/github/callback`,
    });
    return c.redirect(url, HttpStatuses.FOUND);
  });

  app.get("/callback", async (c) => {
    const stateCookie = getCookie(c, STATE_COOKIE);
    const log = c.get("logger");

    if (c.req.query("error") === ACCESS_DENIED) {
      log.debug("sign-in cancelled on GitHub");
      return c.redirect("/", HttpStatuses.FOUND);
    }
    const query = callbackQuerySchema.safeParse({
      code: c.req.query("code"),
      state: c.req.query("state"),
    });
    // CSRF: the returned state must match the cookie set on the login redirect.
    const stateMatches = query.success && stateCookie === query.data.state;
    if (!stateMatches) {
      log.debug("sign-in refused: the state is missing or does not match");
      return redirectHomeWithFailure(c, SignInFailures.SIGN_IN_FAILED);
    }
    // Single-use, and only a matching callback spends it: a cancel or a stale
    // tab must not end the flow another tab shares.
    deleteCookie(c, STATE_COOKIE, HOST_COOKIE_CLEAR);

    let signedIn;
    try {
      signedIn = await completeSignIn(deps, oauthApp, query.data, log);
    } catch (error) {
      log.error("sign-in failed unexpectedly", { err: error });
      return redirectHomeWithFailure(c, SignInFailures.SIGN_IN_FAILED);
    }
    if (!signedIn.ok) {
      return redirectHomeWithFailure(c, signedIn.error);
    }

    setCookie(c, SESSION_COOKIE, signedIn.value, HOST_COOKIE_ATTRIBUTES);
    return c.redirect("/", HttpStatuses.FOUND);
  });

  return app;
}

function redirectHomeWithFailure(c: Context, failure: SignInFailure): Response {
  const search = new URLSearchParams({ [SIGN_IN_FAILURE_PARAM]: failure });
  return c.redirect(`/?${search.toString()}`, HttpStatuses.FOUND);
}
