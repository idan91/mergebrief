// The session-scoped PR list: `GET /api/pulls`, the ONE read that cannot
// reuse the per-repo gate (there is no `:repoId` yet). Composition only.
//
// TENANCY: the authorized repo set comes from the SHARED installation
// resolver (`installation-resolver.ts`, one cache with `/api/repos` and the
// gate). A GitHub failure fails the list (401/502). NEVER a DB-only listing,
// which would leak rows the viewer can no longer see.
import { ProductQueryIds } from "contract";
import {
  productRouter,
  type ProductRouter,
} from "../../product-operations/product-router";
import { WriteClassifications } from "../../product-operations/types";
import type { AuthRouteDeps } from "../auth/session/types";
import type { InstallationResolver } from "../installation-resolver";
import { accessStampLayer, sessionLayer, type AuthzEnv } from "../authz";
import createPullsHandlers from "./handler";

export function pullsRoute(
  deps: AuthRouteDeps,
  installations: InstallationResolver,
): ProductRouter<AuthzEnv> {
  const app = productRouter<AuthzEnv>();
  const handlers = createPullsHandlers(deps.handle, installations);
  app.use("/", sessionLayer(deps), accessStampLayer());
  app.query(
    {
      id: ProductQueryIds.LIST_PULLS,
      classification: WriteClassifications.READ,
    },
    "/",
    handlers.listPulls,
  );
  return app;
}
