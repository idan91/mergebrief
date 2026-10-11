import {
  createPurgeRoutines,
  isOwnerContext,
  type AppDatabase,
  type PullRequestRowId,
} from "persistence";
import type { Result } from "types/utils";
import type { PullRequestAccess } from "../../../../access/types";
import { purgeRowIn } from "../../../purge-row";
import { fetchFreshRepository } from "../../logic/fresh-repository";
import type { DeletePullFailure } from "./types";

const NOT_FOUND = { ok: false, error: { kind: "not-found" } } as const;

/**
 * Admin is read fresh on the viewer's token, never the walk's cached bit.
 * Only an installation row goes here (the descriptor is installation-only,
 * yet the row may still resolve to a url fallback), and the url row the
 * viewer holds at the same coordinates goes with it, or it would resurface
 * as theirs; a pasted row on its own is the inbox's purge.
 */
export async function deletePull(
  handle: AppDatabase,
  access: PullRequestAccess,
): Promise<Result<PullRequestRowId, DeletePullFailure>> {
  const fresh = await fetchFreshRepository(access.github, access.repoId);
  if (!fresh.ok) {
    return fresh;
  }
  if (!fresh.value.info.viewerIsAdmin) {
    return { ok: false, error: { kind: "not-repo-admin" } };
  }
  if (isOwnerContext(access.rowScope)) {
    return NOT_FOUND;
  }

  const reviewerId = access.session.reviewerId;
  const purged = await createPurgeRoutines(
    handle,
    access.rowScope,
  ).purgePullRequest(access.row.id, { reviewerId });
  if (!purged.ok) {
    return NOT_FOUND;
  }

  const shadowScope = { ownerUserId: reviewerId };
  const coordinates = { repoId: access.repoId, prNumber: access.prNumber };
  await purgeRowIn(handle, shadowScope, coordinates, reviewerId);
  return { ok: true, value: access.row.id };
}
