import { ATTACHMENT_BRANCH, buildAttachmentBranchUrl } from "contract";
import type { Result } from "types/utils";
import { bindRepoInstallationGitHub } from "../../../../access/installation-binding";
import type {
  InstallationBindingDeps,
  RepoAccess,
} from "../../../../access/types";
import { FailureKinds } from "../../../../shared-errors/failures";
import { fetchFreshRepository } from "../../logic/fresh-repository";
import type {
  UploadAttachmentFailure,
  UploadAttachmentInput,
  UploadedAttachment,
} from "./types";

/**
 * The repo is re-resolved fresh on the viewer's binding right before the
 * push, as every outward write does; the push itself rides the App's
 * installation, so the commit is the App's and never the viewer's.
 */
export async function uploadAttachment(
  deps: InstallationBindingDeps,
  access: RepoAccess,
  input: UploadAttachmentInput,
): Promise<Result<UploadedAttachment, UploadAttachmentFailure>> {
  const fresh = await fetchFreshRepository(access.github, access.repoId);
  if (!fresh.ok) {
    return fresh;
  }
  const repo = fresh.value.ownerAndName;

  const fileName = input.file.fileName;
  const installation = bindRepoInstallationGitHub(deps, access);
  const committed = await installation.forRepo(repo).commitAttachment({
    branch: ATTACHMENT_BRANCH,
    path: fileName,
    bytes: input.bytes,
  });
  if (!committed.ok) {
    const error = committed.error;
    return {
      ok: false,
      error: { kind: FailureKinds.GITHUB_DENIED, phase: "mutation", error },
    };
  }

  const url = buildAttachmentBranchUrl({ ...repo, fileName });
  return { ok: true, value: { url } };
}
