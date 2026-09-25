import { ApiErrorCodes } from "contract";
import type { Context } from "hono";
import { isOwnerContext } from "persistence";
import {
  BadRequest,
  Forbidden,
  NotFound,
} from "../../../../shared-errors/api-error";
import { stampAuditTarget } from "../../../../product-operations/audit";
import { createReviewerGitHubClient } from "../../../auth/reviewer-github-client";
import type { AuthRouteDeps } from "../../../auth/session/types";
import type { AuthzEnv } from "../../../authz";
import { prNumberSchema } from "../../../wire-bounds";
import { assertHuman } from "../logic/assert-human";
import { throwRepoResolveFailure } from "../logic/resolve-repo-owner-and-name";
import { deleteController } from "./controller";
import { resolveRepoAdmin } from "./logic/resolve-repo-admin";
import type { DeletePullInput } from "./types";

const NO_STORE = { "cache-control": "no-store" } as const;

type DeleteResult = Awaited<ReturnType<typeof deleteController.deleteOwnRow>>;

function respondDeleted(c: Context<AuthzEnv>, deleted: DeleteResult) {
  if (!deleted.ok) {
    throw new NotFound();
  }
  stampAuditTarget(c, "pull_request", deleted.value.pullRequestId);
  return c.json({ ok: true }, 200, NO_STORE);
}

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

    // The one per-PR route that reads the gate's `ctx` directly: the owner
    // world (the operator-PAT rung included) deletes the viewer's own url row
    // with no GitHub call, and so does an installation world holding no row
    // at the coordinates, where the viewer's own pasted row is the only
    // target. An installation row needs admin from a fresh read.
    const ctx = c.get("ctx");
    const input: DeletePullInput = {
      repoId: c.get("repoId"),
      prNumber: parsedPr.data,
      reviewerId: c.get("session").reviewerId,
    };
    if (isOwnerContext(ctx)) {
      const deleted = await deleteController.deleteOwnRow(deps, input);
      return respondDeleted(c, deleted);
    }

    const held = await deleteController.holdsInstallationRow(
      deps,
      ctx.installationId,
      input,
    );
    if (!held) {
      // The ledger keys on the world acted in: the viewer's own url row.
      c.set("ctx", { ownerUserId: input.reviewerId });
      const deleted = await deleteController.deleteOwnRow(deps, input);
      return respondDeleted(c, deleted);
    }

    await assertRepoAdmin(c, deps, input.repoId);
    const deleted = await deleteController.deleteInstallationRow(
      deps,
      ctx.installationId,
      input,
    );
    return respondDeleted(c, deleted);
  };

  return { deletePull };
}
