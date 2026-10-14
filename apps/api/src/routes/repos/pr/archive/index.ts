// PUT and DELETE /api/repos/:repoId/pulls/:prNumber/archive: the viewer's own
// archive of one Inbox row. Private writes, so a Bearer principal at that
// class may call them.
import { ProductActionIds } from "contract";
import type { Handler } from "hono";
import { HttpStatuses } from "types/http";
import type { PullRequestEnv } from "../../../../access/types";
import { stampAuditTarget } from "../../../../product-operations/audit";
import {
  productRouter,
  type ProductRouter,
} from "../../../../product-operations/product-router";
import { NotFound } from "../../../../shared-errors/api-error";
import type { AuthRouteDeps } from "../../../auth/session/types";
import { archivePull, unarchivePull } from "./archive-pull";

const NO_STORE = { "cache-control": "no-store" } as const;

type ArchiveOperation = typeof archivePull;

function createArchiveHandler(
  deps: AuthRouteDeps,
  operation: ArchiveOperation,
): Handler<PullRequestEnv> {
  return async (c) => {
    const written = await operation(deps.handle, c.get("pullRequestAccess"));
    if (!written.ok) {
      throw new NotFound();
    }

    stampAuditTarget(c, "pull_request", written.value);
    return c.json({ ok: true }, HttpStatuses.OK, NO_STORE);
  };
}

export function archivePullRoutes(
  deps: AuthRouteDeps,
): ProductRouter<PullRequestEnv> {
  const app = productRouter<PullRequestEnv>();
  app.action(
    {
      id: ProductActionIds.ARCHIVE_PULL,
      browserSessionOnly: false,
      requiresPushAccess: false,
      requiresInstallation: false,
      requiresStoredPullRequest: true,
    },
    "/",
    createArchiveHandler(deps, archivePull),
  );
  app.action(
    {
      id: ProductActionIds.UNARCHIVE_PULL,
      browserSessionOnly: false,
      requiresPushAccess: false,
      requiresInstallation: false,
      requiresStoredPullRequest: true,
    },
    "/",
    createArchiveHandler(deps, unarchivePull),
  );
  return app;
}
