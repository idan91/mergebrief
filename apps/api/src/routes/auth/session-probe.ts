// GET /api/auth/session: does the request carry a live session? The web
// tier's development-only file-brief readers gate on this answer instead of
// validating a cookie themselves. Cookie-only by construction: `sessionLayer`
// ignores Bearer under `/api/auth/*`. Auth bootstrap like logout, so it is
// not a Product Operation.
import { Hono } from "hono";
import { accessStampLayer, sessionLayer, type AuthzEnv } from "../authz";
import type { AuthRouteDeps } from "./session";

const NO_STORE = { "cache-control": "no-store" } as const;

export function sessionProbeRoute(deps: AuthRouteDeps): Hono<AuthzEnv> {
  const app = new Hono<AuthzEnv>();
  app.use("/", sessionLayer(deps), accessStampLayer());
  app.get("/", (c) => c.json({ ok: true }, 200, NO_STORE));
  return app;
}
