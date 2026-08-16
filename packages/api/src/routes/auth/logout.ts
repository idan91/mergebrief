// POST /api/auth/logout — delete the session row (if any) and clear the cookie.
import { Hono } from "hono";
import { deleteCookie, getCookie } from "hono/cookie";
import { sessionAuth } from "persistence";
import { SESSION_COOKIE, sha256Hex, type AuthRouteDeps } from "./session";

export function logoutRoute(deps: AuthRouteDeps): Hono {
  const app = new Hono();

  app.post("/", async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token !== undefined) {
      await sessionAuth(deps.handle).deleteSession(sha256Hex(token));
    }
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ ok: true }, 200);
  });

  return app;
}
