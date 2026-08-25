// The viewer's url-box world, session-gated ONLY:
//   GET    /api/briefs                      — the "your briefs" home list
//   DELETE /api/briefs/:repoId/:prNumber   — the owner-delete
// Deliberately outside the per-repo GitHub gate: ownership of the rows
// (owner_user_id = the credential's user) is the whole authorization. The
// list is the DISCOVERY surface for url-box briefs (the fail-closed
// allowed-repos list can never include them), and a viewer who has lost
// GitHub access to a repo — or whose repo is gone — must still see and be
// able to erase their own stored data. On the delete, a tenant row, another
// owner's row, and a nonexistent row are one indistinguishable 404.
import {
  PRODUCT_ACTION_ID,
  PRODUCT_QUERY_ID,
} from "../../product-operations/ids";
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
  app.query(
    {
      id: PRODUCT_QUERY_ID.LIST_URL_BRIEFS,
      classification: WRITE_CLASSIFICATION.READ,
    },
    "/",
    handlers.listUrlBriefs,
  );
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
