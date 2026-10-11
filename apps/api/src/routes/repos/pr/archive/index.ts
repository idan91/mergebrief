// PUT and DELETE /api/repos/:repoId/pulls/:prNumber/archive, behind the pr
// subtree's shared gate: the viewer's own archive of one Inbox row. Private
// writes, so a Bearer principal at that class may call them.
import { ProductActionIds } from "contract";
import {
  productRouter,
  type ProductRouter,
} from "../../../../product-operations/product-router";
import { WriteClassifications } from "persistence";
import type { AuthRouteDeps } from "../../../auth/session/types";
import type { AuthzEnv } from "../../../../access/types";
import { createArchiveHandlers } from "./handler";

export function archivePullRoutes(
  deps: AuthRouteDeps,
): ProductRouter<AuthzEnv> {
  const app = productRouter<AuthzEnv>();
  const handlers = createArchiveHandlers(deps);
  app.action(
    {
      id: ProductActionIds.ARCHIVE_PULL,
      classification: WriteClassifications.PRIVATE_WRITE,
      humanOnly: false,
      pushRequired: false,
      installationOnly: false,
      rowRequired: true,
    },
    "put",
    "/",
    handlers.archivePull,
  );
  app.action(
    {
      id: ProductActionIds.UNARCHIVE_PULL,
      classification: WriteClassifications.PRIVATE_WRITE,
      humanOnly: false,
      pushRequired: false,
      installationOnly: false,
      rowRequired: true,
    },
    "delete",
    "/",
    handlers.unarchivePull,
  );
  return app;
}
