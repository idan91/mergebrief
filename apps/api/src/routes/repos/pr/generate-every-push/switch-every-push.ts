import {
  createIngestRoutines,
  createTenantRepository,
  GenerateEveryPushOutcomes,
  type AppDatabase,
  type PullRequestRowId,
} from "persistence";
import type { Result } from "types/utils";
import type { PullRequestAccess } from "../../../../access/types";
import { fetchFreshRepository } from "../../logic/fresh-repository";
import type { TurnOffEveryPushFailure, TurnOnEveryPushFailure } from "./types";

/**
 * Turning it on can release a held head into a paid run that ends in a public
 * Entry post, as a Generate click does, so it rests on push access GitHub
 * confirms now, not on the gate's cached bit. The store decides the release
 * under the pull request's row lock.
 */
export async function turnOnGenerateEveryPush(
  handle: AppDatabase,
  access: PullRequestAccess,
): Promise<Result<PullRequestRowId, TurnOnEveryPushFailure>> {
  const fresh = await fetchFreshRepository(access.github, access.repoId);
  if (!fresh.ok) {
    return fresh;
  }
  if (!fresh.value.info.viewerCanPush) {
    return { ok: false, error: { kind: "no-push-access" } };
  }

  const ingest = createIngestRoutines(handle, access.rowScope);
  const outcome = await ingest.turnOnGenerateEveryPush({
    pullRequestId: access.row.id,
    userId: access.session.reviewerId,
  });
  if (outcome === GenerateEveryPushOutcomes.NOT_FOUND) {
    return { ok: false, error: { kind: "not-found" } };
  }
  return { ok: true, value: access.row.id };
}

/** Writes only MergeBrief's switch and spends nothing, so the gate's push bit is the bar. */
export async function turnOffGenerateEveryPush(
  handle: AppDatabase,
  access: PullRequestAccess,
): Promise<Result<PullRequestRowId, TurnOffEveryPushFailure>> {
  const { pullRequests } = createTenantRepository(handle, access.rowScope);
  const row = await pullRequests.turnOffGenerateEveryPush(access.row.id);
  if (row === undefined) {
    return { ok: false, error: { kind: "not-found" } };
  }
  return { ok: true, value: row.id };
}
