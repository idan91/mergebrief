// `GET /api/version` is skew visibility, not negotiation: the server exposes its
// version, and the latest release it knows of, and the API changelog is keyed
// to it. Gated by the session layer (both channels) like every `/api/*`
// surface, it doubles as the CLI's cheapest authenticated liveness probe.
import { Hono } from "hono";
import type { AuthRouteDeps } from "./auth/session/types";
import { accessStampLayer, sessionLayer, type AuthzEnv } from "./authz";
import { HttpStatuses } from "types/http";
import type { VersionSnapshot } from "../update-check";

const NO_STORE = { "cache-control": "no-store" } as const;

export function versionRoute(
  deps: AuthRouteDeps,
  readVersion: () => VersionSnapshot,
): Hono<AuthzEnv> {
  const app = new Hono<AuthzEnv>();
  app.use("/", sessionLayer(deps), accessStampLayer());
  app.get("/", (c) => c.json(readVersion(), HttpStatuses.OK, NO_STORE));
  return app;
}
