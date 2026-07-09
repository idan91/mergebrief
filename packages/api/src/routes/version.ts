// `GET /api/version` (BRIEF-17 PR 5 — ADR 0029 #8: "skew visibility, not
// negotiation"). The server exposes its version; the CLI's `auth status`
// surfaces it and the API changelog is keyed to it. Gated by the session
// layer (both channels) like every `/api/*` surface — it doubles as the
// CLI's cheapest authenticated liveness probe. The CLI is the first
// consumer, but this is a shared API capability (ADR 0028 #2), not a
// per-CLI endpoint.
import { Hono } from "hono";
import type { AuthRouteDeps } from "./auth";
import { accessLogLayer, sessionLayer, type AuthzEnv } from "./authz";

const NO_STORE = { "cache-control": "no-store" } as const;

export function versionRoute(deps: AuthRouteDeps, serverVersion: string): Hono<AuthzEnv> {
  const app = new Hono<AuthzEnv>();
  app.use("/api/version", sessionLayer(deps), accessLogLayer());
  app.get("/api/version", (c) =>
    c.json({ version: serverVersion }, 200, NO_STORE),
  );
  return app;
}
