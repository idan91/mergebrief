// The one purge both delete routes call: the row at the coordinates in
// ctx's world, and everything hanging off it, with the reviewer named on
// the purge's audit row. `undefined` when the world holds no such row or
// the purge refused, which both routes render as the uniform 404.
import {
  createPurgeRoutines,
  createTenantRepository,
  type AppDatabase,
  type PullRequestRowId,
  type RepoId,
  type ReviewerId,
  type ScopeContext,
} from "persistence";

export interface RowCoordinates {
  readonly repoId: RepoId;
  readonly prNumber: number;
}

export interface RowPurgeFailure {
  readonly kind: "not-found";
}

export async function purgeRowIn(
  handle: AppDatabase,
  ctx: ScopeContext,
  coordinates: RowCoordinates,
  reviewerId: ReviewerId,
): Promise<PullRequestRowId | undefined> {
  const row = await createTenantRepository(
    handle,
    ctx,
  ).pullRequests.getByNumber(coordinates.repoId, coordinates.prNumber);
  if (row === undefined) {
    return undefined;
  }

  const purged = await createPurgeRoutines(handle, ctx).purgePullRequest(
    row.id,
    { reviewerId },
  );
  return purged.ok ? row.id : undefined;
}
