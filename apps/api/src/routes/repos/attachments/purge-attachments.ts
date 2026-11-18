import { ATTACHMENT_BRANCH } from "contract";
import type { Result } from "types/utils";
import { bindRepoInstallationGitHub } from "../../../access/installation-binding";
import type {
  InstallationBindingDeps,
  RepoAccess,
} from "../../../access/types";
import { FailureKinds } from "../../../shared-errors/failures";
import { fetchFreshRepository } from "../logic/fresh-repository";
import type { PurgeAttachmentsFailure, PurgedAttachments } from "./types";

/**
 * Admin is read fresh on the viewer's binding, never the walk's cached bit,
 * and the delete rides the App's installation under the same fresh name.
 */
export async function purgeAttachments(
  deps: InstallationBindingDeps,
  access: RepoAccess,
): Promise<Result<PurgedAttachments, PurgeAttachmentsFailure>> {
  const fresh = await fetchFreshRepository(access.github, access.repoId);
  if (!fresh.ok) {
    return fresh;
  }
  if (!fresh.value.info.viewerIsAdmin) {
    return { ok: false, error: { kind: "not-repo-admin" } };
  }

  const installation = bindRepoInstallationGitHub(deps, access);
  const repo = installation.forRepo(fresh.value.ownerAndName);
  const deleted = await repo.deleteAttachmentBranch(ATTACHMENT_BRANCH);
  if (!deleted.ok) {
    const error = deleted.error;
    return {
      ok: false,
      error: { kind: FailureKinds.GITHUB_DENIED, phase: "mutation", error },
    };
  }
  return { ok: true, value: { existed: deleted.value.existed } };
}
