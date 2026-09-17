import type { Context } from "hono";
import { createTenantRepository } from "persistence";
import { BadRequest, NotFound } from "../../../../shared-errors/api-error";
import { stampAuditTarget } from "../../../../product-operations/audit";
import { createReviewerGitHubClient } from "../../../auth/reviewer-github-client";
import type { AuthRouteDeps } from "../../../auth/session/types";
import type { AuthzEnv } from "../../../authz";
import {
  resolveRepoOwnerAndName,
  throwRepoResolveFailure,
} from "../logic/resolve-repo-owner-and-name";
import { prNumberSchema } from "../wire-bounds";
import readyController from "./controller";
import { throwMarkReadyFailure } from "./logic/wire-failures";
import { resolvePrScopeFrom } from "../scope";

const NO_STORE = { "cache-control": "no-store" } as const;

export default function createHandlers(deps: AuthRouteDeps) {
  const markReady = async (c: Context<AuthzEnv>) => {
    const parsedPr = prNumberSchema.safeParse(c.req.param("prNumber"));
    if (!parsedPr.success) {
      throw new BadRequest();
    }
    const ctx = await resolvePrScopeFrom(c, deps.handle, parsedPr.data);
    const tenant = createTenantRepository(deps.handle, ctx);
    const pr = await tenant.pullRequests.getByNumber(
      c.get("repoId"),
      parsedPr.data,
    );
    if (pr === undefined) {
      throw new NotFound();
    }

    // One refresh-once budget for the WHOLE request, shared across the fresh
    // slug resolve AND the mutation (the ~8h token can expire between them).
    const github = createReviewerGitHubClient(
      deps,
      c.get("session"),
      c.get("logger"),
    );
    const resolvedName = await resolveRepoOwnerAndName(
      { github },
      c.get("repoId"),
    );
    if (!resolvedName.ok) {
      throwRepoResolveFailure(resolvedName.error, c.get("urlBoxOnly") === true);
    }

    const marked = await readyController.markPullRequestReady(
      { github },
      {
        owner: resolvedName.value.owner,
        repo: resolvedName.value.repo,
        prNumber: pr.prNumber,
      },
    );
    if (!marked.ok) {
      throwMarkReadyFailure(marked.error);
    }

    // Success (fresh flip OR already-ready convergence): mirror `draft=false`
    // locally so the FE's pr-view invalidation reflects it immediately. A
    // NOT_FOUND here (PR deleted mid-request) is non-fatal: GitHub is the
    // source of truth and the webhook reconciles; do not fail a converged
    // GitHub state on a local mirror race.
    await createTenantRepository(deps.handle, ctx).pullRequests.setDraft(
      pr.id,
      false,
    );

    stampAuditTarget(c, "pull_request", pr.id);

    return c.json({ draft: false }, 200, NO_STORE);
  };

  return { markReady };
}
