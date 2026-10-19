// GET /api/auth/session: does the request carry a live session, and who is
// the viewer? The Account menu reads its avatar here, the cheapest read that
// knows the session; the web tier's development-only file-brief readers gate
// on the answer instead of validating a cookie themselves. Cookie-only by
// construction: `sessionLayer` ignores Bearer under `/api/auth/*`. Auth
// bootstrap like logout, so it is not a Product Operation.
import type { AuthSessionResponse } from "contract";
import { Hono } from "hono";
import { accessStampLayer, sessionLayer } from "../../../access/session-layer";
import type { AuthzEnv } from "../../../access/types";
import type { AuthRouteDeps } from "./types";
import { shapeViewer } from "../../viewer";
import { HttpStatuses } from "types/http";

const NO_STORE = { "cache-control": "no-store" } as const;

export function sessionRoute(deps: AuthRouteDeps): Hono<AuthzEnv> {
  const app = new Hono<AuthzEnv>();
  app.use("/", sessionLayer(deps), accessStampLayer());
  app.get("/", (c) => {
    const session = c.get("session");
    const operatorIds = c.get("operatorIds");
    const body: AuthSessionResponse = {
      viewer: shapeViewer(session.reviewerId, session.reviewerLogin),
      operator: operatorIds?.has(session.reviewerId) ?? false,
    };
    return c.json(body, HttpStatuses.OK, NO_STORE);
  });
  return app;
}
