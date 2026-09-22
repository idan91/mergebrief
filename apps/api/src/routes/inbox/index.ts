// The Inbox: `GET /api/inbox`, the one list across every installation the
// viewer reaches plus their own url rows, and the owner-delete of one url
// row. Session-gated only: the reachable installations and the readable
// repositories come from the SHARED resolvers, and a GitHub failure fails
// the list (401/502), never a DB-only listing that would leak rows the
// viewer can no longer see.
import { ProductActionIds, ProductQueryIds } from "contract";
import {
  productRouter,
  type ProductRouter,
} from "../../product-operations/product-router";
import { WriteClassifications } from "../../product-operations/types";
import type { AccessibleInstallationsResolver } from "../auth/accessible-installations";
import type { AuthRouteDeps } from "../auth/session/types";
import { accessStampLayer, sessionLayer, type AuthzEnv } from "../authz";
import type { InstallationResolver } from "../installation-resolver";
import type { OpenPullRequest } from "github";
import type { TtlCache } from "../ttl-cache";
import createInboxHandlers from "./handler";

export function inboxRoutes(
  deps: AuthRouteDeps,
  installations: AccessibleInstallationsResolver,
  repos: InstallationResolver,
  openPullsCache: TtlCache<readonly OpenPullRequest[]>,
): ProductRouter<AuthzEnv> {
  const app = productRouter<AuthzEnv>();
  const handlers = createInboxHandlers(
    deps,
    installations,
    repos,
    openPullsCache,
  );
  app.use("*", sessionLayer(deps), accessStampLayer());
  app.query(
    {
      id: ProductQueryIds.LIST_INBOX,
      classification: WriteClassifications.READ,
    },
    "/",
    handlers.listInbox,
  );
  app.action(
    {
      id: ProductActionIds.DELETE_INBOX_ITEM,
      classification: WriteClassifications.PRIVATE_WRITE,
    },
    "delete",
    "/:repoId/:prNumber",
    handlers.deleteInboxItem,
  );
  return app;
}
