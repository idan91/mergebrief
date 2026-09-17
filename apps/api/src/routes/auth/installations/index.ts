// Multi-org session endpoints (GET current/accessible set, POST rebind),
// composition only. The session row's `installation_id` IS the tenant stamp,
// so the rebinding is an atomic `auth_session` UPDATE and the switch emits
// an `auth` audit row at the choke point.
import { ProductActionIds, ProductQueryIds } from "contract";
import {
  productRouter,
  type ProductRouter,
} from "../../../product-operations/product-router";
import { WriteClassifications } from "../../../product-operations/types";
import { accessStampLayer, sessionLayer, type AuthzEnv } from "../../authz";
import type { AuthRouteDeps } from "../session/types";
import createInstallationsHandlers from "./handler";

/** Mount over the session gate (no `:repoId`, same composition as the PR list). */
export function installationsRoutes(
  deps: AuthRouteDeps,
): ProductRouter<AuthzEnv> {
  const app = productRouter<AuthzEnv>();
  const handlers = createInstallationsHandlers(deps);
  app.use("/", sessionLayer(deps), accessStampLayer());
  app.query(
    {
      id: ProductQueryIds.LIST_INSTALLATIONS,
      classification: WriteClassifications.READ,
    },
    "/",
    handlers.listInstallations,
  );
  app.action(
    {
      id: ProductActionIds.SELECT_INSTALLATION,
      classification: WriteClassifications.PRIVATE_WRITE,
    },
    "post",
    "/",
    handlers.selectInstallation,
  );
  return app;
}
