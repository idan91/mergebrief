// The viewer's url-box world, session-gated ONLY: the "your briefs" home
// list and the owner-delete. Deliberately outside the per-repo GitHub gate,
// because row ownership is the whole authorization. The list is the DISCOVERY
// surface for url-box briefs, and a viewer who has lost GitHub access to a
// repo must still see and erase their own stored data. On the delete, a
// tenant row, another owner's row and a nonexistent row are one
// indistinguishable 404.
import { ProductActionIds, ProductQueryIds } from "contract";
import {
  productRouter,
  type ProductRouter,
} from "../../product-operations/product-router";
import { WriteClassifications } from "../../product-operations/types";
import type { AuthRouteDeps } from "../auth/session";
import { accessStampLayer, sessionLayer, type AuthzEnv } from "../authz";
import createUrlBriefHandlers from "./handler";

export function urlBriefRoutes(deps: AuthRouteDeps): ProductRouter<AuthzEnv> {
  const app = productRouter<AuthzEnv>();
  const handlers = createUrlBriefHandlers(deps);
  app.use("*", sessionLayer(deps), accessStampLayer());
  app.query(
    {
      id: ProductQueryIds.LIST_URL_BRIEFS,
      classification: WriteClassifications.READ,
    },
    "/",
    handlers.listUrlBriefs,
  );
  app.action(
    {
      id: ProductActionIds.DELETE_URL_BRIEF,
      classification: WriteClassifications.PRIVATE_WRITE,
    },
    "delete",
    "/:repoId/:prNumber",
    handlers.deleteUrlBrief,
  );
  return app;
}
