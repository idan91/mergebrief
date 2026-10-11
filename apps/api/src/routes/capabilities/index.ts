// `GET /api/capabilities`, itself a registered Product Query: the endpoint
// appears in its own output. Composition only.
import { ProductQueryIds } from "contract";
import { productOperationRegistry } from "../../product-operations/registry";
import {
  productRouter,
  type ProductRouter,
} from "../../product-operations/product-router";
import { WriteClassifications } from "persistence";
import type { AuthRouteDeps } from "../auth/session/types";
import { accessStampLayer, sessionLayer } from "../../access/session-layer";
import type { AuthzEnv } from "../../access/types";
import { createCapabilitiesHandlers } from "./handler";

export function capabilitiesRoute(
  deps: AuthRouteDeps,
): ProductRouter<AuthzEnv> {
  const app = productRouter<AuthzEnv>();
  const handlers = createCapabilitiesHandlers(productOperationRegistry);
  app.use("/", sessionLayer(deps), accessStampLayer());
  app.query(
    {
      id: ProductQueryIds.READ_CAPABILITIES,
      classification: WriteClassifications.READ,
      humanOnly: false,
      pushRequired: false,
      installationOnly: false,
      rowRequired: false,
    },
    "/",
    handlers.readCapabilities,
  );
  return app;
}
