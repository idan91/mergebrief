import {
  createIngestRoutines,
  type RequeueGenerateJobInput,
} from "persistence";
import type { Mutable } from "types/utils";
import type { ParsedGeneratePayload } from "../../payload";
import { AFTER_LEASE_MARGIN_SECONDS, MS_PER_SECOND } from "../consts";
import type { RunStart } from "../types";

/**
 * Whether the recovery job runs the head, read on every attempt. A live lease
 * moves the job to after it and a lapsed one is taken over. A row no run
 * holds belongs to the regular jobs on a first attempt; on a retry it is the
 * row this job's own failed takeover released, and the job runs it again.
 */
export async function shouldRecoverClaim(
  start: RunStart,
  isRetry: boolean,
): Promise<boolean> {
  const { projection, target, log } = start;
  const claim = await projection.readClaim(target);
  if (claim === undefined) {
    return false;
  }
  if (claim.leaseLive) {
    await scheduleClaimRecovery(start, claim.leaseRemainingMs);
    return false;
  }
  if (!claim.claimed) {
    log.debug("generate: recovery found no claim to take over");
    return isRetry;
  }

  log.warn("generate: a claim's lease lapsed, taking its run over");
  return true;
}

/**
 * Queue the head's recovery job for after a lease of `leaseMs` from now. A
 * dead holder's own job stays locked for hours; this one wakes after the lease.
 */
export async function scheduleClaimRecovery(
  start: RunStart,
  leaseMs: number,
): Promise<void> {
  const { deps, payload, log } = start;
  const request = buildAfterLeaseRequest(payload, leaseMs);

  const ingest = createIngestRoutines(deps.handle, payload.ctx);
  await ingest.scheduleClaimRecovery(request);
  log.debug("generate: claim recovery queued", {
    delaySeconds: request.delaySeconds,
  });
}

/** A job's delay that starts a margin after a lease of `leaseMs` ends. */
export function getAfterLeaseDelaySeconds(leaseMs: number): number {
  return Math.ceil(leaseMs / MS_PER_SECOND) + AFTER_LEASE_MARGIN_SECONDS;
}

/** The job request that starts a margin after a lease of `leaseMs` ends. */
export function buildAfterLeaseRequest(
  payload: ParsedGeneratePayload,
  leaseMs: number,
): RequeueGenerateJobInput {
  const request: Mutable<RequeueGenerateJobInput> = {
    pullRequestId: payload.pullRequestId,
    headSha: payload.headSha,
    delaySeconds: getAfterLeaseDelaySeconds(leaseMs),
  };
  if (payload.grantId !== undefined) {
    request.grantId = payload.grantId;
  }
  return request;
}
