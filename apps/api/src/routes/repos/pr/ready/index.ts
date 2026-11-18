// POST /api/repos/:repoId/pulls/:prNumber/ready marks the pull request ready
// with the VIEWER's token, which GitHub checks against the author and
// maintainers. The later `ready_for_review` webhook lands as a no-op. Success
// is a 204: the caller already knows the PR is no longer a draft.
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
import { throwMarkReadyFailure } from "./logic/wire-failures";
import { markPullRequestReady } from "./mark-ready";

const NO_STORE = { "cache-control": "no-store" } as const;

function createMarkReadyHandler(deps: AuthRouteDeps): Handler<PullRequestEnv> {
  return async (c) => {
    const access = c.get("pullRequestAccess");
    const marked = await markPullRequestReady(
      deps.handle,
      c.get("logger"),
      access,
    );
    if (!marked.ok) {
      throwMarkReadyFailure(marked.error, access.footing);
    }

    stampAuditTarget(c, "pull_request", marked.value);
    return c.body(null, HttpStatuses.NO_CONTENT, NO_STORE);
  };
}

export function markReadyRoute(
  deps: AuthRouteDeps,
): ProductRouter<PullRequestEnv> {
  const app = productRouter<PullRequestEnv>();
  app.action(
    {
      id: ProductActionIds.MARK_READY,
      browserSessionOnly: false,
      requiresOperator: false,
      requiresPushAccess: false,
      requiresInstallation: false,
      requiresStoredPullRequest: true,
    },
    "/",
    createMarkReadyHandler(deps),
  );
  return app;
}
