// Hono-free. The caller resolved the allowed set and judges its failures.
import type { RepoId } from "persistence";

interface RepoListEntry {
  readonly repoId: string;
  readonly fullName: string;
}

export default {
  /** Deterministic order for humans and diffs: fullName ascending. */
  listRepos(allowed: ReadonlyMap<RepoId, string>): {
    repos: readonly RepoListEntry[];
  } {
    const repos = [...allowed.entries()]
      .map(([repoId, fullName]) => ({ repoId: String(repoId), fullName }))
      .toSorted((a, b) => a.fullName.localeCompare(b.fullName));
    return { repos };
  },
};
