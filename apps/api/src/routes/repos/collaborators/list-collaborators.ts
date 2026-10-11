import type { InstallationId, RepoId } from "persistence";
import type { Result } from "types/utils";
import { bindRepoInstallationGitHub } from "../../../access/installation-binding";
import { readInstallationId } from "../../../access/installation-scope";
import type { RepoAccess } from "../../../access/types";
import { FailureKinds } from "../../../shared-errors/failures";
import { parseOwnerAndName } from "../utils";
import { COLLABORATORS_CACHE_TTL_MS } from "./consts";
import type { CollaboratorsDeps, ListCollaboratorsFailure } from "./types";

const NOT_FOUND = { ok: false, error: { kind: "not-found" } } as const;

function buildCollaboratorsCacheKey(
  installationId: InstallationId,
  repoId: RepoId,
): string {
  return `${String(installationId)}:${String(repoId)}`;
}

/**
 * The repository's roster as the wire body, read as the App by the gate's
 * verified slug. The descriptor's push requirement refuses a read-only
 * viewer before this repo-shared cache is reached; a failure is never cached.
 */
export async function listCollaborators(
  deps: CollaboratorsDeps,
  access: RepoAccess,
): Promise<Result<string, ListCollaboratorsFailure>> {
  const installationId = readInstallationId(access);
  const key = buildCollaboratorsCacheKey(installationId, access.repoId);
  const now = Date.now();
  const cached = deps.cache.get(key, now);
  if (cached !== undefined) {
    return { ok: true, value: cached };
  }

  const repo = parseOwnerAndName(access.repoFullName);
  if (repo === undefined) {
    return NOT_FOUND;
  }
  const github = bindRepoInstallationGitHub(deps, access);
  const listed = await github.forRepo(repo).listRepoCollaborators();
  if (!listed.ok) {
    const error = listed.error;
    return { ok: false, error: { kind: FailureKinds.GITHUB_DENIED, error } };
  }

  const body = JSON.stringify(listed.value);
  deps.cache.set(key, body, now + COLLABORATORS_CACHE_TTL_MS, now);
  return { ok: true, value: body };
}
