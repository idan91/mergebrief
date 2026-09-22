// The session list spans every installation the viewer reaches, but each
// store read takes one scope: the allowed set is split per installation, one
// read runs per installation, and the pages merge newest first under the
// caller's cap. Transitional: the Inbox query reads across scopes in SQL.
import type { InstallationId, RepoId } from "persistence";
import type { AllowedRepo } from "../../installation-resolver";
import type { PrView } from "../../pr-view";

export type AllowedByInstallation = ReadonlyMap<
  InstallationId,
  ReadonlyMap<RepoId, AllowedRepo>
>;

export function groupAllowedByInstallation(
  allowed: ReadonlyMap<RepoId, AllowedRepo>,
): AllowedByInstallation {
  const groups = new Map<InstallationId, Map<RepoId, AllowedRepo>>();
  for (const [repoId, repo] of allowed) {
    const group = groups.get(repo.installationId) ?? new Map();
    group.set(repoId, repo);
    groups.set(repo.installationId, group);
  }
  return groups;
}

/** Newest `updatedAt` first across every page, capped at `limit`. */
export function mergePullPages(
  pages: ReadonlyArray<readonly PrView[]>,
  limit: number,
): PrView[] {
  return pages
    .flat()
    .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, limit);
}
