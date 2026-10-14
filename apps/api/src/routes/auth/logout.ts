// POST /api/auth/logout: delete the session row (if any) and clear the cookie.
// Outside `sessionLayer` because an unknown cookie still answers 204, so the
// same-origin proof every cookie mutation owes runs here through the layer's
// own helper, with no principal to name.
import { Hono } from "hono";
import { deleteCookie, getCookie } from "hono/cookie";
import { createSessionAuth } from "persistence";
import { requireSameOrigin } from "../../access/session-layer";
import type { AuthzEnv } from "../../access/types";
import type { AuthRouteDeps } from "./session/types";
import { HOST_COOKIE_CLEAR, SESSION_COOKIE } from "./session/consts";
import { resolveAllowedOrigin } from "./session/logic/same-origin";
import { sha256Hex } from "./session/utils";
import { HttpStatuses } from "types/http";

const NO_STORE = { "cache-control": "no-store" } as const;

export function logoutRoute(deps: AuthRouteDeps): Hono<AuthzEnv> {
  const app = new Hono<AuthzEnv>();
  const allowedOrigin = resolveAllowedOrigin(deps.auth.publicBaseUrl);

  app.post("/", async (c) => {
    requireSameOrigin(c, allowedOrigin);

    const token = getCookie(c, SESSION_COOKIE);
    if (token !== undefined) {
      await createSessionAuth(deps.handle).deleteSession(sha256Hex(token));
    }
    deleteCookie(c, SESSION_COOKIE, HOST_COOKIE_CLEAR);
    return c.body(null, HttpStatuses.NO_CONTENT, NO_STORE);
  });

  return app;
}
