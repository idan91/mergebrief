import {
  createIngestRoutines,
  RegenerateOutcomes,
  type AppDatabase,
  type PullRequestRowId,
} from "persistence";
import type { Result } from "types/utils";
import type { PullRequestAccess } from "../../../../access/types";
import { fetchFreshRepository } from "../../logic/fresh-repository";
import type { RegenerateFailure } from "./types";

/**
 * A rerun spends a model call and ends in a public Entry post, so it rests
 * on push access GitHub confirms now, not on the gate's cached bit. The
 * worker reads the pull request fresh when the queued job runs.
 */
export async function regenerateBrief(
  handle: AppDatabase,
  access: PullRequestAccess,
): Promise<Result<PullRequestRowId, RegenerateFailure>> {
  const fresh = await fetchFreshRepository(access.github, access.repoId);
  if (!fresh.ok) {
    return fresh;
  }
  if (!fresh.value.info.viewerCanPush) {
    return { ok: false, error: { kind: "no-push-access" } };
  }

  const ingest = createIngestRoutines(handle, access.rowScope);
  const outcome = await ingest.regenerateFailedHead({
    pullRequestId: access.row.id,
  });
  if (outcome !== RegenerateOutcomes.QUEUED) {
    return { ok: false, error: { kind: outcome } };
  }
  return { ok: true, value: access.row.id };
}
