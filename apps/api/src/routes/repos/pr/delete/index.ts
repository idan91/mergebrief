// DELETE /api/repos/:repoId/pulls/:prNumber erases one pull request's briefs
// and everything hanging off them. Cookie only, installation only, and admin
// on a fresh repository read; the purge's audit row names the reviewer.
import { ProductActionIds } from "contract";
import type { Handler } from "hono";
import { HttpStatuses } from "types/http";
import type { PullRequestEnv } from "../../../../access/types";
import { stampAuditTarget } from "../../../../product-operations/audit";
import {
  productRouter,
  type ProductRouter,
} from "../../../../product-operations/product-router";
import type { AuthRouteDeps } from "../../../auth/session/types";
import { deletePull } from "./delete-pull";
import { throwDeletePullFailure } from "./logic/wire-failures";

const NO_STORE = { "cache-control": "no-store" } as const;

function createDeletePullHandler(deps: AuthRouteDeps): Handler<PullRequestEnv> {
  return async (c) => {
    const access = c.get("pullRequestAccess");
    const deleted = await deletePull(deps.handle, access);
    if (!deleted.ok) {
      throwDeletePullFailure(deleted.error, access.footing);
    }

    stampAuditTarget(c, "pull_request", deleted.value);
    return c.json({ ok: true }, HttpStatuses.OK, NO_STORE);
  };
}

export function deletePullRoute(
  deps: AuthRouteDeps,
): ProductRouter<PullRequestEnv> {
  const app = productRouter<PullRequestEnv>();
  app.action(
    {
      id: ProductActionIds.DELETE_PULL,
      browserSessionOnly: true,
      requiresPushAccess: false,
      requiresInstallation: true,
      requiresStoredPullRequest: true,
    },
    "/",
    createDeletePullHandler(deps),
  );
  return app;
}
