import type { InstallationId, RepoId } from "persistence";

/** ONE key builder for the cache and its eviction hook — they must agree. */
export function buildConversationCacheKey(
  installationId: InstallationId,
  repoId: RepoId,
  prNumber: number,
): string {
  return `${String(installationId)}:${String(repoId)}:${prNumber}`;
}
