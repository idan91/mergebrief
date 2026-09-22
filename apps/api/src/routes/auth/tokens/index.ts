// API-token mint/list/revoke, the BROWSER-ONLY management surface for the
// second presentation channel. Cookie-authed by construction: these live
// under `/api/auth/*`, where the session layer IGNORES Bearer headers, a
// token can never mint tokens. Composition only.
import { ProductActionIds, ProductQueryIds } from "contract";
import {
  productRouter,
  type ProductRouter,
} from "../../../product-operations/product-router";
import { WriteClassifications } from "../../../product-operations/types";
import { accessStampLayer, sessionLayer, type AuthzEnv } from "../../authz";
import type { AuthRouteDeps } from "../session/types";
import type { AccessibleInstallationsResolver } from "../accessible-installations";
import createTokensHandlers from "./handler";

/** Mount the token-management surface over the cookie session gate. */
export function tokensRoutes(
  deps: AuthRouteDeps,
  installations: AccessibleInstallationsResolver,
): ProductRouter<AuthzEnv> {
  const app = productRouter<AuthzEnv>();
  const handlers = createTokensHandlers(deps, installations);
  app.use("/", sessionLayer(deps), accessStampLayer());
  app.use("/:id", sessionLayer(deps), accessStampLayer());
  app.action(
    {
      id: ProductActionIds.MINT_TOKEN,
      classification: WriteClassifications.PRIVATE_WRITE,
    },
    "post",
    "/",
    handlers.mintToken,
  );
  app.query(
    {
      id: ProductQueryIds.LIST_TOKENS,
      classification: WriteClassifications.READ,
    },
    "/",
    handlers.listTokens,
  );
  app.action(
    {
      id: ProductActionIds.REVOKE_TOKEN,
      classification: WriteClassifications.PRIVATE_WRITE,
    },
    "delete",
    "/:id",
    handlers.revokeToken,
  );
  return app;
}
