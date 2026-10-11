// DELETE /api/repos/:repoId/pulls/:prNumber, behind the pr subtree's shared
// gate: erases one pull request's briefs and everything hanging off them.
// Cookie only, and in the installation world admin on a fresh repository
// read; the purge's audit row names the reviewer.
import { ProductActionIds } from "contract";
import {
  productRouter,
  type ProductRouter,
} from "../../../../product-operations/product-router";
import { WriteClassifications } from "persistence";
import type { AuthRouteDeps } from "../../../auth/session/types";
import type { AuthzEnv } from "../../../../access/types";
import { createDeleteHandlers } from "./handler";

export function deletePullRoute(deps: AuthRouteDeps): ProductRouter<AuthzEnv> {
  const app = productRouter<AuthzEnv>();
  const handlers = createDeleteHandlers(deps);
  app.action(
    {
      id: ProductActionIds.DELETE_PULL,
      classification: WriteClassifications.PRIVATE_WRITE,
    },
    "delete",
    "/",
    handlers.deletePull,
  );
  return app;
}
