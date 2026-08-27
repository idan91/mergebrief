// The session-scoped PR list: `GET /api/pulls` — the ONE read that cannot
// reuse the per-repo gate (there is no `:repoId` yet). Composition only.
//
// TENANCY: the authorized repo set comes from the SHARED allowed-set resolver
// (`allowed-repos.ts`, one cache with `/api/repos`). A GitHub failure fails
// the list (401/502) — NEVER a DB-only listing, which would leak rows the
// viewer can no longer see.
import { ProductQueryIds } from "../../product-operations/ids";
import {
  productRouter,
  type ProductRouter,
} from "../../product-operations/product-router";
import { WRITE_CLASSIFICATION } from "../../product-operations/types";
import type { AuthRouteDeps } from "../auth/session";
import type { AllowedRepoResolver } from "../allowed-repos";
import { accessStampLayer, sessionLayer, type AuthzEnv } from "../authz";
import createPullsHandlers from "./handler";

export function pullsRoute(
  deps: AuthRouteDeps,
  allowedRepos: AllowedRepoResolver,
): ProductRouter<AuthzEnv> {
  const app = productRouter<AuthzEnv>();
  const handlers = createPullsHandlers(deps.handle, allowedRepos);
  app.use("/", sessionLayer(deps), accessStampLayer());
  app.query(
    {
      id: ProductQueryIds.LIST_PULLS,
      classification: WRITE_CLASSIFICATION.READ,
    },
    "/",
    handlers.listPulls,
  );
  return app;
}
