import { ApiErrorCodes } from "contract";
import type { Context } from "hono";
import { Forbidden } from "../../../shared-errors/api-error";
import { createReviewerGitHubClient } from "../../auth/reviewer-github-client";
import { readInstallationId } from "../../../access/installation-scope";
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
  // Human-only and installation-only on the descriptor: the delete signs
  // under the reviewer's confirmation, and an owner-world repo has no branch.
  const purgeAttachments = async (c: Context<AuthzEnv>) => {
    const installationId = readInstallationId(c.get("repoAccess"));
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
