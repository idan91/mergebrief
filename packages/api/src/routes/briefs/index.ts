// DELETE /api/briefs/:repoId/:prNumber — the owner-delete: erase a url-box
// brief the viewer owns. Session-gated ONLY, deliberately outside the
// per-repo GitHub gate: ownership of the row (owner_user_id = the
// credential's user) is the whole authorization, and a viewer who has lost
// GitHub access to the repo — or whose repo is gone — must still be able to
// erase their own stored data. A tenant row, another owner's row, and a
// nonexistent row are one indistinguishable 404.
import { PRODUCT_ACTION_ID } from "../../product-operations/ids";
import {
  productRouter,
  type ProductRouter,
} from "../../product-operations/product-router";
import { WRITE_CLASSIFICATION } from "../../product-operations/types";
import type { AuthRouteDeps } from "../auth/session";
import { accessStampLayer, sessionLayer, type AuthzEnv } from "../authz";
import createUrlBriefHandlers from "./handler";

export function urlBriefRoutes(deps: AuthRouteDeps): ProductRouter<AuthzEnv> {
  const app = productRouter<AuthzEnv>();
  const handlers = createUrlBriefHandlers(deps);
  app.use("*", sessionLayer(deps), accessStampLayer());
  app.action(
    {
      id: PRODUCT_ACTION_ID.DELETE_URL_BRIEF,
      classification: WRITE_CLASSIFICATION.PRIVATE_WRITE,
    },
    "delete",
    "/:repoId/:prNumber",
    handlers.deleteUrlBrief,
  );
  return app;
}
