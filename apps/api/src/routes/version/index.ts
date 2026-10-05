// `GET /api/version` is skew visibility, not negotiation: the server exposes
// its version, the latest release it knows of, and the viewer's dismissal.
// Gated by the session layer (both channels) like every `/api/*` surface, it
// doubles as the CLI's cheapest authenticated liveness probe, and it stays
// outside the Product Operation catalog on purpose (the exempt set). The
// dismiss write beside it is a catalogued, human-only product action.
import { ProductActionIds } from "contract";
import { Hono } from "hono";
import {
  productRouter,
  type ProductRouter,
} from "../../product-operations/product-router";
import { WriteClassifications } from "persistence";
import type { AuthRouteDeps } from "../auth/session/types";
import { accessStampLayer, sessionLayer, type AuthzEnv } from "../authz";
import { createVersionHandlers } from "./handler";
import type { VersionControllerDeps } from "./types";

export type VersionRouteDeps = AuthRouteDeps & VersionControllerDeps;

export function versionRoute(deps: VersionRouteDeps): Hono<AuthzEnv> {
  const app = new Hono<AuthzEnv>();
  const handlers = createVersionHandlers(deps);
  app.use("/", sessionLayer(deps), accessStampLayer());
  app.get("/", handlers.readVersion);
  return app;
}

/** Mounted at `/version/dismiss`: `POST /api/version/dismiss`. */
export function versionDismissRoutes(
  deps: VersionRouteDeps,
): ProductRouter<AuthzEnv> {
  const app = productRouter<AuthzEnv>();
  const handlers = createVersionHandlers(deps);
  app.use("*", sessionLayer(deps), accessStampLayer());
  app.action(
    {
      id: ProductActionIds.DISMISS_VERSION_NOTICE,
      classification: WriteClassifications.PRIVATE_WRITE,
    },
    "post",
    "/",
    handlers.dismissVersion,
  );
  return app;
}
