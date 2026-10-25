import {
  ClaimOutcomes,
  createIngestRoutines,
  type BriefSpanRow,
  type ClaimRunOutcome,
  type GenerationProjection,
  type GenerationRow,
  type GenerationTarget,
} from "persistence";
import { GenerationFailureCodes, GenerationStatuses } from "types/generations";
import { RunDecisionKinds, type RunContext, type RunDecision } from "../types";
import { buildAttemptFields } from "../utils";
import {
  buildAfterLeaseRequest,
  scheduleClaimRecovery,
} from "./claim-recovery";
import { postFailedEntry } from "./failed-entry";
import { listRunStops, traceRunStep } from "./step-span";
import { applySpendGate, refuseAtCap } from "./spend-gate";

/**
 * Whether the run reaches a model, decided once. A run over the pair's stored
 * brief on a row no run claimed takes no claim: it meets the cap here as a
 * ceiling and is charged at its first paid call. A fresh run, a recovery run,
 * or any run over a row a claim still names projects itself if ingest did not
 * and claims the row under the cap (the claim queuing the head's recovery job
 * unless this run is one), or stands down when another run holds or finished
 * it, a held one re-queuing its job for after the lease. `run.leaveRow` and
 * `run.runId` are settled here, before any provider call.
 */
export async function decideRun(context: RunContext): Promise<RunDecision> {
  const { payload, run, existingBrief } = context;
  if (existingBrief !== undefined && !context.recovering) {
    const unclaimed = await decideUnclaimedStoredBriefRun(
      context,
      existingBrief,
    );
    if (unclaimed !== undefined) {
      return unclaimed;
    }
  }

  if (existingBrief === undefined) {
    await projectIfUnprojected(
      context.projection,
      context.target,
      context.projected,
    );
  }
  run.leaveRow = false;
  const claim = await traceRunStep(
    "generation.claim",
    listRunStops(context),
    async (span) => {
      const claimed = await applySpendGate(payload, context);
      span.setAttributes({ "mergebrief.claim": claimed.kind });
      return claimed;
    },
  );
  if (claim.kind === ClaimOutcomes.HELD) {
    await followHolder(context, claim.leaseRemainingMs);
  }
  if (claim.kind === ClaimOutcomes.EXHAUSTED) {
    await settleExhaustedRun(context, claim.claims);
  }
  return decideFromClaim(context, claim);
}

/**
 * `undefined` when a claim still names the row, live or lapsed: a holder may
 * be paying for this head, and the recovery job takes a lapsed claim over, so
 * this run goes through the claim and meets them there.
 */
async function decideUnclaimedStoredBriefRun(
  context: RunContext,
  storedBrief: BriefSpanRow,
): Promise<RunDecision | undefined> {
  const { payload, run, projection, target } = context;
  const claim = await projection.readClaim(target);
  if (claim?.claimed === true) {
    return undefined;
  }

  run.leaveRow = true;
  const refused = await refuseAtCap(payload, context);
  if (refused) {
    return { kind: RunDecisionKinds.CAPPED, storedBrief };
  }
  return { kind: RunDecisionKinds.STORED_BRIEF, storedBrief };
}

/**
 * The head's paid attempts since its last trigger are spent, and the job ends
 * without a retry. A stored brief settles the row; otherwise it ends `failed`
 * as `attempts-exhausted`, keeping a failure already there, and the failed
 * Entry names the failure the row keeps.
 */
async function settleExhaustedRun(
  context: RunContext,
  claims: number,
): Promise<void> {
  const { projection, target, existingBrief, pickedUpAt, projected, log } =
    context;
  log.error(
    "generate: the head's attempts are spent, ending the run without a retry",
    { evt: "job.retries.exhausted", ...buildAttemptFields(claims) },
  );

  if (existingBrief !== undefined) {
    await projection.settleStoredBrief(target, pickedUpAt);
    return;
  }
  const exhausted = { code: GenerationFailureCodes.ATTEMPTS_EXHAUSTED };
  if (projected?.status !== GenerationStatuses.FAILED) {
    const marked = await projection.markFailed(target, exhausted);
    if (marked.ok) {
      await postFailedEntry({ scope: context, context }, exhausted.code);
    }
    return;
  }
  await postFailedEntry(
    { scope: context, context },
    projected.errorCode ?? exhausted.code,
  );
}

/** A recovery run moves its own job past the lease; any other re-queues its head. */
async function followHolder(
  context: RunContext,
  leaseRemainingMs: number,
): Promise<void> {
  if (context.recovering) {
    await scheduleClaimRecovery(context, leaseRemainingMs);
    return;
  }
  await requeueAfterLease(context, leaseRemainingMs);
}

/**
 * The holder may be dead with its lease still live, and this job may be the
 * head's only one, so a held run queues a follow-up for after the lease.
 */
async function requeueAfterLease(
  context: RunContext,
  leaseRemainingMs: number,
): Promise<void> {
  const { deps, payload, log } = context;
  const request = buildAfterLeaseRequest(payload, leaseRemainingMs);

  const ingest = createIngestRoutines(deps.handle, payload.ctx);
  const requeued = await ingest.requeueGenerateJob(request);
  const message = requeued.queued
    ? "generate: re-queued for after the holder's lease"
    : "generate: a queued job already follows the holder";
  log.info(message, { delaySeconds: request.delaySeconds });
}

function decideFromClaim(
  context: RunContext,
  claim: ClaimRunOutcome,
): RunDecision {
  const { run, existingBrief, log } = context;
  if (claim.kind === ClaimOutcomes.CLAIMED) {
    run.runId = claim.runId;
    run.attempt = claim.claims;
    if (existingBrief !== undefined) {
      return {
        kind: RunDecisionKinds.STORED_BRIEF,
        storedBrief: existingBrief,
      };
    }
    return { kind: RunDecisionKinds.FRESH, runId: claim.runId };
  }
  if (claim.kind === ClaimOutcomes.CAPPED) {
    return { kind: RunDecisionKinds.CAPPED, storedBrief: existingBrief };
  }

  run.leaveRow = true;
  log.info(`generate: standing down, the generation row is ${claim.kind}`);
  return { kind: RunDecisionKinds.STAND_DOWN };
}

/**
 * Ingest projects a run it expects; one it classified as covered by the
 * stored base, while the live base moved, arrives unprojected and projects
 * itself so the attempt counts and the wait state shows. Only a succeeded row
 * (or none) means that: a failed row is graphile retrying a transient
 * failure, and a retry keeps its status until the gate decides.
 */
async function projectIfUnprojected(
  projection: GenerationProjection,
  target: GenerationTarget,
  current: GenerationRow | undefined,
): Promise<void> {
  if (
    current !== undefined &&
    current.status !== GenerationStatuses.SUCCEEDED
  ) {
    return;
  }
  await projection.upsertPending(target);
}
