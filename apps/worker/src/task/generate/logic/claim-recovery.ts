import {
  createIngestRoutines,
  type GenerationFailure,
  type RequeueGenerateJobInput,
} from "persistence";
import {
  GenerationFailureCodes,
  GenerationStatuses,
  type GenerationFailureCode,
  type Mutable,
} from "types";
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

/** A recovery job past its first attempt; graphile counts from 1. */
export function isRecoveryRetry(start: RunStart): boolean {
  return (start.job?.attempts ?? 1) > 1;
}

/**
 * Where a recovery job's unclaimed run leaves the row once no attempt
 * follows: the lapsed claim it found, or the row its own takeover released,
 * ends `failed`, and a row its own earlier attempt failed keeps that failure.
 * The code the row now reads `failed` with, or undefined when it does not.
 */
export async function endUnclaimedRecovery(
  start: RunStart,
  failure: GenerationFailure,
): Promise<GenerationFailureCode | undefined> {
  const { projection, target, log } = start;
  const ended = await projection.endLapsedClaim(target, {
    status: GenerationStatuses.FAILED,
    failure,
  });
  if (ended.ok) {
    const attemptsSpent =
      failure.code === GenerationFailureCodes.ATTEMPTS_EXHAUSTED;
    const message = attemptsSpent
      ? "generate: recovery attempts spent, the lapsed claim ends failed"
      : "generate: recovery failed for good, the lapsed claim ends failed";
    log.warn(message, { code: failure.code });
    return failure.code;
  }

  // On a retry, a `pending` row no run holds is the one this job's own
  // takeover released on shutdown, and nothing else ends it.
  if (isRecoveryRetry(start)) {
    const failed = await projection.endReleasedClaim(target, {
      status: GenerationStatuses.FAILED,
      failure,
    });
    if (failed.ok) {
      log.warn("generate: recovery ends the row its takeover released failed", {
        code: failure.code,
      });
      return failure.code;
    }
  }

  const row = await projection.get(target);
  const failedUnclaimed =
    row?.status === GenerationStatuses.FAILED && row.runId === null;
  if (!failedUnclaimed) {
    return undefined;
  }
  return row.errorCode ?? undefined;
}

/**
 * A recovery run whose head moved before its claim ends the lapsed claim it
 * found `superseded`, or the row its own takeover released.
 */
export async function supersedeUnclaimedRecovery(
  start: RunStart,
): Promise<void> {
  const { projection, target } = start;
  const ended = await projection.endLapsedClaim(target, {
    status: GenerationStatuses.SUPERSEDED,
  });
  const leavesReleasedRow = ended.ok || !isRecoveryRetry(start);
  if (leavesReleasedRow) {
    return;
  }
  await projection.endReleasedClaim(target, {
    status: GenerationStatuses.SUPERSEDED,
  });
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
