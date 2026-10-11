import { ApiErrorCodes } from "contract";
import type { Context } from "hono";
import {
  BadRequest,
  Forbidden,
  NotFound,
} from "../../../../shared-errors/api-error";
import { stampAuditTarget } from "../../../../product-operations/audit";
import { createReviewerGitHubClient } from "../../../auth/reviewer-github-client";
import type { AuthRouteDeps } from "../../../auth/session/types";
import { readInstallationId } from "../../../../access/installation-scope";
import type { AuthzEnv } from "../../../../access/types";
import { prNumberSchema } from "../../../wire-bounds";
import { throwRepoResolveFailure } from "../../logic/resolve-repo-owner-and-name";
import { deleteController } from "./controller";
import { resolveRepoAdmin } from "../../logic/resolve-repo-admin";
import type { DeletePullInput } from "./types";
import { HttpStatuses } from "types/http";

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

    // Installation-only on the descriptor: the viewer's own pasted row goes
    // through the inbox purge instead.
    const installationId = readInstallationId(c.get("repoAccess"));
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
    return c.json({ ok: true }, HttpStatuses.OK, NO_STORE);
  };

  return { deletePull };
}
