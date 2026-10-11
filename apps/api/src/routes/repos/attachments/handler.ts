import { ApiErrorCodes } from "contract";
import type { Context } from "hono";
import { Forbidden } from "../../../shared-errors/api-error";
import { stampAuditTarget } from "../../../product-operations/audit";
import { assertHuman } from "../../assert-human";
import { createReviewerGitHubClient } from "../../auth/reviewer-github-client";
import { requireInstallationScope } from "../../../access/installation-scope";
import type { AuthzEnv } from "../../../access/types";
import { throwAttachmentBranchFailure } from "../logic/attachment-branch-failure";
import { resolveRepoAdmin, type RepoAdmin } from "../logic/resolve-repo-admin";
import { throwRepoResolveFailure } from "../logic/resolve-repo-owner-and-name";
import { purgeAttachmentsController } from "./controller";
import type {
  PurgeAttachmentsHandlers,
  PurgeAttachmentsRouteDeps,
} from "./types";
import { HttpStatuses } from "types/http";

const NO_STORE = { "cache-control": "no-store" } as const;
async function resolveAdmin(
  c: Context<AuthzEnv>,
  deps: PurgeAttachmentsRouteDeps,
): Promise<RepoAdmin> {
  const github = createReviewerGitHubClient(
    deps,
    c.get("session"),
    c.get("logger"),
  );
  const fresh = await resolveRepoAdmin({ github }, c.get("repoId"));
  if (!fresh.ok) {
    throwRepoResolveFailure(fresh.error);
  }
  if (!fresh.value.viewerIsAdmin) {
    throw new Forbidden(ApiErrorCodes.ATTACHMENTS_ADMIN_ONLY);
  }
  return fresh.value;
}

export function createPurgeAttachmentsHandlers(
  deps: PurgeAttachmentsRouteDeps,
): PurgeAttachmentsHandlers {
  // Cookie only: the delete signs under the reviewer's confirmation, and
  // App-only, since the owner world has no branch and nothing to delete
  // it with.
  const purgeAttachments = async (c: Context<AuthzEnv>) => {
    // Stamped first, so a refusal past the gate names the repository too.
    stampAuditTarget(c, "repository", c.get("repoId"));
    assertHuman(c);
    const installationId = requireInstallationScope(c.get("ctx"));
    const admin = await resolveAdmin(c, deps);

    const purged = await purgeAttachmentsController.purgeAttachments(
      { port: deps.github },
      {
        installationId,
        owner: admin.ownerAndName.owner,
        repo: admin.ownerAndName.repo,
      },
    );
    if (!purged.ok) {
      throwAttachmentBranchFailure(purged.error.error);
    }

    c.get("logger").debug("attachments branch purged", {
      existed: purged.value.existed,
    });
    return c.json({ ok: true }, HttpStatuses.OK, NO_STORE);
  };

  return { purgeAttachments };
}
