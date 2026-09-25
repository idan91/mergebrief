// Hono-free. Two purge sequences over the tenant-scoped purge routines: the
// viewer's own url row, and an installation row together with the url row
// the same viewer may hold at the same coordinates, which would otherwise
// resurface as theirs the moment the installation row stopped shadowing it.
import {
  createPurgeRoutines,
  createTenantRepository,
  type InstallationId,
  type PullRequestRowId,
  type ScopeContext,
} from "persistence";
import type { Result } from "types/utils";
import type {
  DeleteControllerDeps,
  DeletePullFailure,
  DeletePullInput,
} from "./types";

type DeletePullResult = Result<
  { readonly pullRequestId: PullRequestRowId },
  DeletePullFailure
>;

const NOT_FOUND: DeletePullResult = {
  ok: false,
  error: { kind: "not-found" },
};

async function purgeRowIn(
  deps: DeleteControllerDeps,
  ctx: ScopeContext,
  input: DeletePullInput,
): Promise<PullRequestRowId | undefined> {
  const row = await createTenantRepository(
    deps.handle,
    ctx,
  ).pullRequests.getByNumber(input.repoId, input.prNumber);
  if (row === undefined) {
    return undefined;
  }

  const purged = await createPurgeRoutines(deps.handle, ctx).purgePullRequest(
    row.id,
    { reviewerId: input.reviewerId },
  );
  return purged.ok ? row.id : undefined;
}

async function deleteOwnRow(
  deps: DeleteControllerDeps,
  input: DeletePullInput,
): Promise<DeletePullResult> {
  const ownCtx = { ownerUserId: input.reviewerId };
  const pullRequestId = await purgeRowIn(deps, ownCtx, input);
  if (pullRequestId === undefined) {
    return NOT_FOUND;
  }
  return { ok: true, value: { pullRequestId } };
}

/** Whether the installation holds a row at the coordinates; without one the viewer's own url row is the only target. */
async function holdsInstallationRow(
  deps: DeleteControllerDeps,
  installationId: InstallationId,
  input: DeletePullInput,
): Promise<boolean> {
  const row = await createTenantRepository(deps.handle, {
    installationId,
  }).pullRequests.getByNumber(input.repoId, input.prNumber);
  return row !== undefined;
}

async function deleteInstallationRow(
  deps: DeleteControllerDeps,
  installationId: InstallationId,
  input: DeletePullInput,
): Promise<DeletePullResult> {
  const pullRequestId = await purgeRowIn(deps, { installationId }, input);
  if (pullRequestId === undefined) {
    return NOT_FOUND;
  }

  await purgeRowIn(deps, { ownerUserId: input.reviewerId }, input);
  return { ok: true, value: { pullRequestId } };
}

export const deleteController = {
  deleteOwnRow,
  holdsInstallationRow,
  deleteInstallationRow,
};
