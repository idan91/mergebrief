// DELETE /api/auth/sessions: every session of the signed-in reviewer, the
// caller's own included, the "sign out everywhere" a leaked cookie needs.
// Cookie-only by construction, like the token surface: `sessionLayer`
// ignores Bearer under `/api/auth/*`, so a stolen token cannot sign its
// owner out. Composition only.
import { ProductActionIds } from "contract";
import {
  productRouter,
  type ProductRouter,
} from "../../../product-operations/product-router";
import { WriteClassifications } from "../../../product-operations/types";
import { accessStampLayer, sessionLayer, type AuthzEnv } from "../../authz";
import type { AuthRouteDeps } from "../session/types";
import { createSessionsHandlers } from "./handler";

export function sessionsRoutes(deps: AuthRouteDeps): ProductRouter<AuthzEnv> {
  const app = productRouter<AuthzEnv>();
  const handlers = createSessionsHandlers(deps);
  app.use("/", sessionLayer(deps), accessStampLayer());
  app.action(
    {
      id: ProductActionIds.REVOKE_SESSIONS,
      classification: WriteClassifications.PRIVATE_WRITE,
    },
    "delete",
    "/",
    handlers.revokeAll,
  );
  return app;
}
