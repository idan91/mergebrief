import {
  createGenerationProjection,
  createIngestRoutines,
  TriggerOnDemandOutcomes,
  type AppDatabase,
  type PullRequestRowId,
  type TriggerOnDemandInput,
} from "persistence";
import { GenerationStatuses } from "types";
import type { Mutable, Result } from "types/utils";
import type { PullRequestAccess } from "../../../../access/types";
import { AuthChannels } from "../../../auth/session/types";
import { fetchFreshRepository } from "../../logic/fresh-repository";
import type { RegenerateFailure } from "./types";

/**
 * A rerun spends a model call and ends in a public Entry post, and a Trigger
 * approval lasts for the PR, so both rest on push access GitHub confirms at
 * the click, not on the gate's cached bit. The worker reads the pull request
 * fresh when the queued job runs. Only a browser session names its reviewer
 * as the approver, so an API token on a head awaiting its trigger is
 * refused before any GitHub read, while a failed head stays open to one.
 * The store still decides under its lock.
 */
export async function regenerateBrief(
  handle: AppDatabase,
  access: PullRequestAccess,
): Promise<Result<PullRequestRowId, RegenerateFailure>> {
  const browserSession = access.session.channel === AuthChannels.COOKIE;
  if (!browserSession) {
    const awaitsApprover = await isAwaitingTrigger(handle, access);
    if (awaitsApprover) {
      return {
        ok: false,
        error: { kind: TriggerOnDemandOutcomes.NEEDS_APPROVER },
      };
    }
  }

  const fresh = await fetchFreshRepository(access.github, access.repoId);
  if (!fresh.ok) {
    return fresh;
  }
  if (!fresh.value.info.viewerCanPush) {
    return { ok: false, error: { kind: "no-push-access" } };
  }

  const ingest = createIngestRoutines(handle, access.rowScope);
  const input: Mutable<TriggerOnDemandInput> = {
    pullRequestId: access.row.id,
  };
  if (browserSession) {
    input.approverId = access.session.reviewerId;
  }

  const outcome = await ingest.triggerOnDemand(input);
  if (outcome !== TriggerOnDemandOutcomes.QUEUED) {
    return { ok: false, error: { kind: outcome } };
  }
  return { ok: true, value: access.row.id };
}

/** The PR's current head waits for a person's Trigger approval. */
async function isAwaitingTrigger(
  handle: AppDatabase,
  access: PullRequestAccess,
): Promise<boolean> {
  const generations = createGenerationProjection(handle, access.rowScope);
  const latest = await generations.latestBriefForPullRequests([access.row.id]);
  const head = latest.get(access.row.id);
  return head?.status === GenerationStatuses.AWAITING_TRIGGER;
}
