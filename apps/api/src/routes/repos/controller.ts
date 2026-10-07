// Hono-free. The caller resolved the allowed set and judges its failures.
import type { RepoId } from "persistence";
import type { AllowedRepo } from "../installation-resolver";

interface RepoListEntry {
  readonly repoId: string;
  readonly fullName: string;
}

export const reposController = {
  /** Deterministic order for humans and diffs: fullName ascending. */
  listRepos(allowed: ReadonlyMap<RepoId, AllowedRepo>): {
    repos: readonly RepoListEntry[];
  } {
    const repos = [...allowed.entries()]
      .map(([repoId, repo]) => ({
        repoId: String(repoId),
        fullName: repo.fullName,
      }))
      .toSorted((a, b) => a.fullName.localeCompare(b.fullName));
    return { repos };
  },
};
