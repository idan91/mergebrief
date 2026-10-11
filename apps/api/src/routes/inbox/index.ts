// The Inbox: `GET /api/inbox`, the one list across every installation the
// viewer reaches plus their own url rows, and the owner-only purge of one
// pasted row. Session-gated only: the reachable installations and the
// readable repositories come from the SHARED resolvers, and a GitHub
// failure fails the list (401/502), never a DB-only listing that would leak
// rows the viewer can no longer see. The purge makes no GitHub call at all,
// so a pasted row whose repository nobody can read any more still goes.
import { ProductActionIds, ProductQueryIds } from "contract";
import {
  productRouter,
  type ProductRouter,
} from "../../product-operations/product-router";
import { WriteClassifications } from "persistence";
import type { AccessibleInstallationsResolver } from "../auth/accessible-installations";
import type { AuthRouteDeps } from "../auth/session/types";
import { accessStampLayer, sessionLayer } from "../../access/session-layer";
import type { AuthzEnv } from "../../access/types";
import type { InstallationResolver } from "../installation-resolver";
import type { OpenPullRequest } from "brief-core/pr-stack";
import type { TtlCache } from "../ttl-cache";
import { createInboxHandlers } from "./handler";

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
      id: ProductActionIds.DELETE_OWN_PULL,
      classification: WriteClassifications.PRIVATE_WRITE,
    },
    "delete",
    "/:repoId/:prNumber",
    handlers.deleteOwnPull,
  );
  return app;
}
