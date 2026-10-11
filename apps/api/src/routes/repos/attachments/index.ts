// DELETE /api/repos/:repoId/attachments, behind the repos router's gate:
// deletes the repository's whole attachments branch. Cookie only,
// admin on a fresh repository read, and every image a comment embedded from
// the branch breaks; the audit row names the reviewer and the repository.
import { ProductActionIds } from "contract";
import {
  productRouter,
  type ProductRouter,
} from "../../../product-operations/product-router";
import { WriteClassifications } from "persistence";
import type { AuthzEnv } from "../../../access/types";
import { createPurgeAttachmentsHandlers } from "./handler";
import type { PurgeAttachmentsRouteDeps } from "./types";

export function purgeAttachmentsRoute(
  deps: PurgeAttachmentsRouteDeps,
): ProductRouter<AuthzEnv> {
  const app = productRouter<AuthzEnv>();
  const handlers = createPurgeAttachmentsHandlers(deps);

  app.action(
    {
      id: ProductActionIds.PURGE_ATTACHMENTS,
      classification: WriteClassifications.EXTERNAL_WRITE,
    },
    "delete",
    "/",
    handlers.purgeAttachments,
  );
  return app;
}
