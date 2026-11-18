import type { AppDatabase, PullRequestRowId, ReviewerId } from "persistence";
import type { Result } from "types/utils";
import {
  purgeRowIn,
  type RowCoordinates,
  type RowPurgeFailure,
} from "../purge-row";

const NOT_FOUND = { ok: false, error: { kind: "not-found" } } as const;

/**
 * Erase the viewer's own pasted row and everything hanging off it. The owner
 * scope is the wall: a row in any installation, or another reviewer's paste,
 * is indistinguishable from none. No GitHub call.
 */
export async function deleteOwnPull(
  handle: AppDatabase,
  ownerUserId: ReviewerId,
  coordinates: RowCoordinates,
): Promise<Result<PullRequestRowId, RowPurgeFailure>> {
  const pullRequestId = await purgeRowIn(
    handle,
    { ownerUserId },
    coordinates,
    ownerUserId,
  );
  if (pullRequestId === undefined) {
    return NOT_FOUND;
  }
  return { ok: true, value: pullRequestId };
}
