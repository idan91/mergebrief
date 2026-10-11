import type { Logger } from "logging";
import type { RepoId } from "persistence";
import type { Result } from "types/utils";
import type { RequestGitHub } from "../../access/reviewer-binding";
import type {
  AllowedRepo,
  InstallationResolver,
  ResolverFailure,
} from "../installation-resolver";

export interface RepoListEntry {
  readonly repoId: string;
  readonly fullName: string;
}

export interface RepoList {
  readonly repos: readonly RepoListEntry[];
}

/** Deterministic order for humans and diffs: fullName ascending. */
function shapeRepoList(allowed: ReadonlyMap<RepoId, AllowedRepo>): RepoList {
  const repos = [...allowed.entries()]
    .map(([repoId, repo]) => ({
      repoId: String(repoId),
      fullName: repo.fullName,
    }))
    .toSorted((first, second) => first.fullName.localeCompare(second.fullName));
  return { repos };
}

/** The allowed set from the shared resolver, on the request's binding. */
export async function listRepos(
  installations: InstallationResolver,
  request: RequestGitHub,
  log: Logger,
): Promise<Result<RepoList, ResolverFailure>> {
  const resolved = await installations.listAllowedRepos(request, log);
  if (!resolved.ok) {
    return resolved;
  }
  return { ok: true, value: shapeRepoList(resolved.value.allowed) };
}
