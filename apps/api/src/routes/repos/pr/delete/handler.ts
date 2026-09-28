import { ApiErrorCodes } from "contract";
import type { Context } from "hono";
import {
  BadRequest,
  Forbidden,
  NotFound,
} from "../../../../shared-errors/api-error";
import { stampAuditTarget } from "../../../../product-operations/audit";
import { assertHuman } from "../../../assert-human";
import { createReviewerGitHubClient } from "../../../auth/reviewer-github-client";
import type { AuthRouteDeps } from "../../../auth/session/types";
import { requireInstallationScope, type AuthzEnv } from "../../../authz";
import { prNumberSchema } from "../../../wire-bounds";
import { throwRepoResolveFailure } from "../../logic/resolve-repo-owner-and-name";
import { deleteController } from "./controller";
import { resolveRepoAdmin } from "../../logic/resolve-repo-admin";
import type { DeletePullInput } from "./types";

const NO_STORE = { "cache-control": "no-store" } as const;

async function assertRepoAdmin(
  c: Context<AuthzEnv>,
  deps: AuthRouteDeps,
  repoId: DeletePullInput["repoId"],
): Promise<void> {
  const github = createReviewerGitHubClient(
    deps,
    c.get("session"),
    c.get("logger"),
  );
  const fresh = await resolveRepoAdmin({ github }, repoId);
  if (!fresh.ok) {
    throwRepoResolveFailure(fresh.error);
  }
  if (!fresh.value.viewerIsAdmin) {
    throw new Forbidden(ApiErrorCodes.REPO_ADMIN_ONLY);
  }
}

export function createDeleteHandlers(deps: AuthRouteDeps) {
  const deletePull = async (c: Context<AuthzEnv>) => {
    const parsedPr = prNumberSchema.safeParse(c.req.param("prNumber"));
    if (!parsedPr.success) {
      throw new BadRequest();
    }
    assertHuman(c);

    // An App-only surface: the owner world, the PAT rung included, 404s
    // here, and the viewer's own pasted row goes through the inbox purge.
    const installationId = requireInstallationScope(c.get("ctx"));
    const input: DeletePullInput = {
      repoId: c.get("repoId"),
      prNumber: parsedPr.data,
      reviewerId: c.get("session").reviewerId,
    };
    await assertRepoAdmin(c, deps, input.repoId);

    const deleted = await deleteController.deleteInstallationRow(
      deps,
      installationId,
      input,
    );
    if (!deleted.ok) {
      throw new NotFound();
    }
    stampAuditTarget(c, "pull_request", deleted.value.pullRequestId);
    return c.json({ ok: true }, 200, NO_STORE);
  };

  return { deletePull };
}
