// DELETE /api/repos/:repoId/attachments, behind the repos router's gate:
// deletes the repository's whole attachments branch. Cookie only,
// admin on a fresh repository read, and every image a comment embedded from
// the branch breaks; the audit row names the reviewer and the repository.
import { ProductActionIds } from "contract";
import type { Handler } from "hono";
import { HttpStatuses } from "types/http";
import type { AuthzEnv, InstallationBindingDeps } from "../../../access/types";
import {
  productRouter,
  type ProductRouter,
} from "../../../product-operations/product-router";
import { createRepositoryTargetLayer } from "../logic/repository-target";
import { throwPurgeAttachmentsFailure } from "./logic/wire-failures";
import { purgeAttachments } from "./purge-attachments";

const NO_STORE = { "cache-control": "no-store" } as const;

function createPurgeAttachmentsHandler(
  deps: InstallationBindingDeps,
): Handler<AuthzEnv> {
  return async (c) => {
    const access = c.get("repoAccess");
    const purged = await purgeAttachments(deps, access);
    if (!purged.ok) {
      throwPurgeAttachmentsFailure(purged.error, access.footing);
    }

    c.get("logger").debug("attachments branch purged", {
      existed: purged.value.existed,
    });
    return c.json({ ok: true }, HttpStatuses.OK, NO_STORE);
  };
}

export function purgeAttachmentsRoute(
  deps: InstallationBindingDeps,
): ProductRouter<AuthzEnv> {
  const app = productRouter<AuthzEnv>();
  const bindInstallationGitHub = deps.bindInstallationGitHub;

  app.use(createRepositoryTargetLayer());
  // Human-only and installation-only: the delete signs under the reviewer's
  // confirmation, and an owner-world repo has no branch.
  app.action(
    {
      id: ProductActionIds.PURGE_ATTACHMENTS,
      browserSessionOnly: true,
      requiresPushAccess: false,
      requiresInstallation: true,
      requiresStoredPullRequest: false,
    },
    "/",
    createPurgeAttachmentsHandler({ bindInstallationGitHub }),
  );
  return app;
}
