// POST /api/repos/:repoId/pulls/:prNumber/regenerate queues a fresh run of
// the pull request's failed or awaiting-trigger current head for a viewer who
// can push. Success is a 202: the run happens later, in the worker.
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
import { throwRegenerateFailure } from "./logic/wire-failures";
import { regenerateBrief } from "./regenerate-brief";

const NO_STORE = { "cache-control": "no-store" } as const;

function createRegenerateHandler(deps: AuthRouteDeps): Handler<PullRequestEnv> {
  return async (c) => {
    const access = c.get("pullRequestAccess");
    const regenerated = await regenerateBrief(deps.handle, access);
    if (!regenerated.ok) {
      throwRegenerateFailure(regenerated.error, access.footing);
    }

    stampAuditTarget(c, "pull_request", regenerated.value);
    return c.body(null, HttpStatuses.ACCEPTED, NO_STORE);
  };
}

export function regenerateRoute(
  deps: AuthRouteDeps,
): ProductRouter<PullRequestEnv> {
  const app = productRouter<PullRequestEnv>();
  app.action(
    {
      id: ProductActionIds.REGENERATE_BRIEF,
      browserSessionOnly: false,
      requiresOperator: false,
      requiresPushAccess: true,
      requiresInstallation: true,
      requiresStoredPullRequest: true,
    },
    "/",
    createRegenerateHandler(deps),
  );
  return app;
}
