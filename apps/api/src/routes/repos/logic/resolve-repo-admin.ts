// The fresh admin read for a delete: the gate's walk carries the same bit
// up to 60s stale, and an admin who just lost the role must not delete on it.
import type { RepoId } from "persistence";
import type { Result } from "types/utils";
import type { ReviewerGitHubClient } from "../../auth/reviewer-github-client";
import {
  fetchRepositoryFresh,
  type RepoOwnerAndName,
  type RepoResolveFailure,
} from "./resolve-repo-owner-and-name";

export interface RepoAdmin {
  readonly viewerIsAdmin: boolean;
  /** The repository's current name pair, from the same fresh read. */
  readonly ownerAndName: RepoOwnerAndName;
}

export async function resolveRepoAdmin(
  deps: { readonly github: ReviewerGitHubClient },
  repoId: RepoId,
): Promise<Result<RepoAdmin, RepoResolveFailure>> {
  const fresh = await fetchRepositoryFresh(deps, repoId);
  if (!fresh.ok) {
    return fresh;
  }
  return {
    ok: true,
    value: {
      viewerIsAdmin: fresh.value.info.viewerIsAdmin,
      ownerAndName: fresh.value.ownerAndName,
    },
  };
}
