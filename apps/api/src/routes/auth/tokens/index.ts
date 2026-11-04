// API-token mint/list/revoke, the BROWSER-ONLY management surface for the
// second presentation channel. Cookie-authed by construction: these live
// under `/api/auth/*`, where the session layer IGNORES Bearer headers, a
// token can never mint tokens. Composition only.
import { ProductActionIds, ProductQueryIds } from "contract";
import {
  productRouter,
  type ProductRouter,
} from "../../../product-operations/product-router";
import type { InstanceAccessCheck } from "../../../access/instance-access";
import { accessStampLayer, sessionLayer } from "../../../access/session-layer";
import type { AuthzEnv } from "../../../access/types";
import type { AuthRouteDeps } from "../session/types";
import { createTokensHandlers } from "./handler";

/** Mount the token-management surface over the cookie session gate. */
export function tokensRoutes(
  deps: AuthRouteDeps,
  instanceAccess: InstanceAccessCheck,
): ProductRouter<AuthzEnv> {
  const app = productRouter<AuthzEnv>();
  const handlers = createTokensHandlers(deps, instanceAccess);
  app.use("/", sessionLayer(deps), accessStampLayer());
  app.use("/:id", sessionLayer(deps), accessStampLayer());
  app.action(
    {
      id: ProductActionIds.MINT_TOKEN,
      browserSessionOnly: false,
      requiresOperator: false,
      requiresPushAccess: false,
      requiresInstallation: false,
      requiresStoredPullRequest: false,
    },
    "/",
    handlers.mintToken,
  );
  app.query(
    {
      id: ProductQueryIds.LIST_TOKENS,
      browserSessionOnly: false,
      requiresOperator: false,
      requiresPushAccess: false,
      requiresInstallation: false,
      requiresStoredPullRequest: false,
    },
    "/",
    handlers.listTokens,
  );
  app.action(
    {
      id: ProductActionIds.REVOKE_TOKEN,
      browserSessionOnly: false,
      requiresOperator: false,
      requiresPushAccess: false,
      requiresInstallation: false,
      requiresStoredPullRequest: false,
    },
    "/:id",
    handlers.revokeToken,
  );
  return app;
}
