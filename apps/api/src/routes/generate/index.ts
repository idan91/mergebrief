// POST /api/generate — turn an arbitrary PR URL into an owner-scoped
// (url-box) brief. Session-gated only (`sessionLayer`, no per-repo gate): the
// target repo comes from the pasted URL, not from an installation — the
// viewer-token GitHub resolve inside the controller IS the access check. Its
// denial posture is a uniform 404: FORBIDDEN and NOT_FOUND are
// indistinguishable to the caller (no existence leak), mirroring the
// cold-denial posture of the gated routes. Generation itself runs in the
// worker; the response carries the PR coordinates the web polls.
import { ProductActionIds } from "../../product-operations/ids";
import {
  productRouter,
  type ProductRouter,
} from "../../product-operations/product-router";
import { WriteClassifications } from "../../product-operations/types";
import type { AuthRouteDeps } from "../auth/session";
import { accessStampLayer, sessionLayer, type AuthzEnv } from "../authz";
import createGenerateHandlers from "./handler";

export function generateRoute(
  deps: AuthRouteDeps,
  fallbackToken: string | undefined,
): ProductRouter<AuthzEnv> {
  const app = productRouter<AuthzEnv>();
  const handlers = createGenerateHandlers(deps, fallbackToken);
  app.use("/", sessionLayer(deps), accessStampLayer());
  app.action(
    {
      id: ProductActionIds.GENERATE_BRIEF,
      classification: WriteClassifications.PRIVATE_WRITE,
    },
    "post",
    "/",
    handlers.generateBrief,
  );
  return app;
}
