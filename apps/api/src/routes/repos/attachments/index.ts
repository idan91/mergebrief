// DELETE /api/repos/:repoId/attachments, behind its own per-repo gate
// instance: deletes the repository's whole attachments branch. Cookie only,
// admin on a fresh repository read, and every image a comment embedded from
// the branch breaks; the audit row names the reviewer and the repository.
import { ProductActionIds } from "contract";
import {
  productRouter,
  type ProductRouter,
} from "../../../product-operations/product-router";
import { WriteClassifications } from "../../../product-operations/types";
import { createAuthzMiddleware, type AuthzEnv } from "../../authz";
import type { InstallationResolver } from "../../installation-resolver";
import { createPurgeAttachmentsHandlers } from "./handler";
import type { PurgeAttachmentsRouteDeps } from "./types";

export function purgeAttachmentsRoute(
  deps: PurgeAttachmentsRouteDeps,
  installations: InstallationResolver,
): ProductRouter<AuthzEnv> {
  const app = productRouter<AuthzEnv>();
  const authz = createAuthzMiddleware(deps, installations);
  const handlers = createPurgeAttachmentsHandlers(deps);

  app.use("/", authz);
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
