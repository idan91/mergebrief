// The fresh admin read: `GET /repositories/{id}` with the viewer's token,
// immediately before the delete. The gate's walk carries the same bit up to
// 60s stale, and an admin who just lost the role must not delete on it.
import { createUserOctokit, fetchRepositoryById } from "github";
import type { RepoId } from "persistence";
import type { Result } from "types/utils";
import { buildGitHubDeniedResult } from "../../../../../shared-errors/failures";
import type { ReviewerGitHubClient } from "../../../../auth/reviewer-github-client";
import type { RepoResolveFailure } from "../../logic/resolve-repo-owner-and-name";

export interface RepoAdmin {
  readonly viewerIsAdmin: boolean;
}

export async function resolveRepoAdmin(
  deps: { readonly github: ReviewerGitHubClient },
  repoId: RepoId,
): Promise<Result<RepoAdmin, RepoResolveFailure>> {
  const repoInfo = await deps.github.run((token) =>
    fetchRepositoryById(createUserOctokit(token), repoId),
  );
  if (!repoInfo.ok) {
    return buildGitHubDeniedResult(repoInfo.error, "resolve");
  }
  return { ok: true, value: { viewerIsAdmin: repoInfo.value.viewerIsAdmin } };
}
