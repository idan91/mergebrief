// Multi-org session endpoints (GET current/accessible set, POST rebind) —
// composition only. The session row's `installation_id` IS the tenant stamp,
// so the rebinding is an atomic `auth_session` UPDATE and the switch emits
// an `auth` audit row at the choke point.
import {
  PRODUCT_ACTION_ID,
  PRODUCT_QUERY_ID,
} from "../../../product-operations/ids";
import {
  productRouter,
  type ProductRouter,
} from "../../../product-operations/product-router";
import { WRITE_CLASSIFICATION } from "../../../product-operations/types";
import { accessStampLayer, sessionLayer, type AuthzEnv } from "../../authz";
import type { AuthRouteDeps } from "../session";
import createInstallationsHandlers from "./handler";

/** Mount over the session gate (no `:repoId` — same composition as the PR list). */
export function installationsRoute(
  deps: AuthRouteDeps,
): ProductRouter<AuthzEnv> {
  const app = productRouter<AuthzEnv>();
  const handlers = createInstallationsHandlers(deps);
  app.use("/", sessionLayer(deps), accessStampLayer());
  app.query(
    {
      id: PRODUCT_QUERY_ID.LIST_INSTALLATIONS,
      classification: WRITE_CLASSIFICATION.READ,
    },
    "/",
    handlers.listInstallations,
  );
  app.action(
    {
      id: PRODUCT_ACTION_ID.SELECT_INSTALLATION,
      classification: WRITE_CLASSIFICATION.PRIVATE_WRITE,
    },
    "post",
    "/",
    handlers.selectInstallation,
  );
  return app;
}
