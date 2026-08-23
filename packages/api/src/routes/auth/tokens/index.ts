// API-token mint/list/revoke — the BROWSER-ONLY management surface for the
// second presentation channel. Cookie-authed by construction: these live
// under `/api/auth/*`, where the session layer IGNORES Bearer headers — a
// token can never mint tokens. Composition only.
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
import createTokensHandlers from "./handler";

/** Mount the token-management surface over the cookie session gate. */
export function tokensRoutes(deps: AuthRouteDeps): ProductRouter<AuthzEnv> {
  const app = productRouter<AuthzEnv>();
  const handlers = createTokensHandlers(deps);
  app.use("/", sessionLayer(deps), accessStampLayer());
  app.use("/:id", sessionLayer(deps), accessStampLayer());
  app.action(
    {
      id: PRODUCT_ACTION_ID.MINT_TOKEN,
      classification: WRITE_CLASSIFICATION.PRIVATE_WRITE,
    },
    "post",
    "/",
    handlers.mintToken,
  );
  app.query(
    {
      id: PRODUCT_QUERY_ID.LIST_TOKENS,
      classification: WRITE_CLASSIFICATION.READ,
    },
    "/",
    handlers.listTokens,
  );
  app.action(
    {
      id: PRODUCT_ACTION_ID.REVOKE_TOKEN,
      classification: WRITE_CLASSIFICATION.PRIVATE_WRITE,
    },
    "delete",
    "/:id",
    handlers.revokeToken,
  );
  return app;
}
