// POST /api/generate — brief an arbitrary PR URL with the VIEWER's token.
// Session-gated only (`sessionLayer`, no per-repo gate): the target repo comes
// from the pasted URL, not from an installation — the viewer-token GitHub
// fetch inside the engine IS the access check. Its denial posture is a
// uniform 404: FORBIDDEN and NOT_FOUND are indistinguishable to the caller
// (no existence leak), mirroring the cold-denial posture of the gated routes.
import { PRODUCT_ACTION_ID } from "../../product-operations/ids";
import {
  productRouter,
  type ProductRouter,
} from "../../product-operations/product-router";
import { WRITE_CLASSIFICATION } from "../../product-operations/types";
import type { AuthRouteDeps } from "../auth/session";
import { accessStampLayer, sessionLayer, type AuthzEnv } from "../authz";
import createGenerateHandlers from "./handler";
import type { UrlBriefEngine } from "./types";
import { createSingleFlight } from "./utils";

export function generateRoute(
  deps: AuthRouteDeps,
  engine: UrlBriefEngine | undefined,
): ProductRouter<AuthzEnv> {
  const app = productRouter<AuthzEnv>();
  const handlers = createGenerateHandlers(deps, engine, createSingleFlight());
  app.use("/", sessionLayer(deps), accessStampLayer());
  app.action(
    {
      id: PRODUCT_ACTION_ID.GENERATE_BRIEF,
      classification: WRITE_CLASSIFICATION.PRIVATE_WRITE,
    },
    "post",
    "/",
    handlers.generateBrief,
  );
  return app;
}
