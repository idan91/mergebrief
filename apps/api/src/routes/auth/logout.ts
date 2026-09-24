// POST /api/auth/logout: delete the session row (if any) and clear the cookie.
import { Hono } from "hono";
import { deleteCookie, getCookie } from "hono/cookie";
import { createSessionAuth } from "persistence";
import type { AuthRouteDeps } from "./session/types";
import { HOST_COOKIE_CLEAR, SESSION_COOKIE } from "./session/consts";
import { sha256Hex } from "./session/utils";

export function logoutRoute(deps: AuthRouteDeps): Hono {
  const app = new Hono();

  app.post("/", async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token !== undefined) {
      await createSessionAuth(deps.handle).deleteSession(sha256Hex(token));
    }
    deleteCookie(c, SESSION_COOKIE, HOST_COOKIE_CLEAR);
    return c.json({ ok: true }, 200);
  });

  return app;
}
