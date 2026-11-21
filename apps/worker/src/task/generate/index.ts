import type { Generator } from "generators";
import type { Logger } from "logging";
import {
  createGenerationProjection,
  type GenerationFailure,
} from "persistence";
import { GenerationFailureCodes, GenerationStatuses } from "types/generations";
import { TransientJobError } from "../failure";
import { parseGeneratePayload } from "../payload";
import {
  endUnclaimedRecovery,
  shouldRecoverClaim,
  supersedeUnclaimedRecovery,
} from "./logic/claim-recovery";
import { applyAuthorGate } from "./logic/author-gate";
import { applyConditionCheck } from "./logic/condition-check";
import {
  isPermanentSyncFailure,
  queueEntrySync,
  reportEntrySyncFailure,
  syncEntryComment,
} from "./logic/entry-sync";
import { traceProviderCalls } from "./logic/model-span";
import { listRunStops, traceRunStep } from "./logic/step-span";
import { postFailedEntry } from "./logic/failed-entry";
import { reportJobFailure } from "./logic/job-failure";
import { postOwedReadyEntry, postReadyEntry } from "./logic/ready-entry";
import {
  finishRun,
  produceBrief,
  settleStoredBriefRun,
  writeFollowOnArtifacts,
} from "./logic/run-artifacts";
import {
  openRun,
  scheduleUrlBoxRegenerationIfMoved,
} from "./logic/run-context";
import { decideRun } from "./logic/run-decision";
import { prepareRunInputs } from "./logic/run-inputs";
import { routeRunToLargePool } from "./logic/pool-routing";
import {
  ClaimLostSignal,
  isRunSignal,
  SpendCappedSignal,
  SupersededSignal,
} from "./logic/run-signals";
import { bindAbortSignal } from "./logic/supersession-watch";
import {
  AuthorGateKinds,
  ConditionCheckKinds,
  JobFailureOutcomes,
  RunDecisionKinds,
  RunPools,
  type GenerateTask,
  type GenerateTaskDeps,
  type GenerateTaskHelpers,
  type GenerateTaskOptions,
  type GeneratingRun,
  type JobFailureReport,
  type PreClaimReads,
  type RunContext,
  type RunPool,
  type RunProgress,
  type RunStart,
  type RunState,
  type SupersessionWatch,
} from "./types";
import {
  buildAttemptFields,
  createNoopLogger,
  getBriefTarget,
  isFinalRunAttempt,
} from "./utils";

export type { GenerateTaskDeps, GenerateTaskOptions } from "./types";

/**
 * Build the generate task. The returned function is graphile's `Task` shape;
 * tests call it directly with a payload (helpers optional). The large pool's
 * task is the same function told its pool, so it never re-routes.
 */
export function createGenerateTask(
  deps: GenerateTaskDeps,
  options: GenerateTaskOptions = {},
): GenerateTask {
  const log = deps.log ?? createNoopLogger();
  const pool = options.pool ?? RunPools.NORMAL;

  return async function generate(
    rawPayload: unknown,
    helpers?: GenerateTaskHelpers,
  ): Promise<void> {
    const start = buildRunStart(deps, log, rawPayload, helpers, pool);
    if (start === undefined) {
      return;
    }
    const run: RunStart = { ...start, recovering: false };
    await runJob(run, async (progress) => runGeneration(run, progress));
  };
}

/**
 * Build the recovery task, queued per head when a run claims it. It does
 * nothing unless the claim's lease lapsed with the run unfinished, or a
 * takeover handed the row back owing a retry, then runs the head as
 * `generate` does, claiming the row even over a stored brief.
 */
export function createRecoverGenerationTask(
  deps: GenerateTaskDeps,
  options: GenerateTaskOptions = {},
): GenerateTask {
  const log = deps.log ?? createNoopLogger();
  const pool = options.pool ?? RunPools.NORMAL;

  return async function recoverGeneration(
    rawPayload: unknown,
    helpers?: GenerateTaskHelpers,
  ): Promise<void> {
    const opened = buildRunStart(deps, log, rawPayload, helpers, pool);
    if (opened === undefined) {
      return;
    }
    const start: RunStart = { ...opened, recovering: true };
    // Nothing before the run decision may mark the row.
    start.run.leaveRow = true;
    await runJob(start, async (progress) => {
      if (await shouldRecoverClaim(start)) {
        await runGeneration(start, progress);
      }
    });
  };
}

/**
 * Build the Entry sync task, queued per head ahead of a write that ends a
 * run for good and when its pull request closes. It renders the Entry the
 * head's row names; a GitHub failure throws so graphile retries it. A url-box
 * job never writes to GitHub.
 */
export function createSyncEntryTask(deps: GenerateTaskDeps): GenerateTask {
  const log = deps.log ?? createNoopLogger();

  return async function syncEntry(
    rawPayload: unknown,
    helpers?: GenerateTaskHelpers,
  ): Promise<void> {
    const parsed = parseGeneratePayload(rawPayload);
    if (!parsed.ok) {
      log.warn(`entry sync: dropping malformed payload, ${parsed.error}`);
      return;
    }
    const payload = parsed.value;
    if (payload.grantId !== undefined) {
      return;
    }

    const jobLog = log.child({
      prId: String(payload.pullRequestId),
      headSha: payload.headSha,
    });
    try {
      await syncEntryComment(deps, payload, jobLog);
    } catch (error) {
      if (isPermanentSyncFailure(error)) {
        jobLog.warn("entry sync: refused for good, nothing to retry");
        return;
      }
      reportEntrySyncFailure(jobLog, helpers?.job);
      throw error;
    }
  };
}

function buildRunStart(
  deps: GenerateTaskDeps,
  log: Logger,
  rawPayload: unknown,
  helpers: GenerateTaskHelpers | undefined,
  pool: RunPool,
): Omit<RunStart, "recovering"> | undefined {
  const parsed = parseGeneratePayload(rawPayload);
  if (!parsed.ok) {
    // Poisoned/foreign job: no projection row is addressable, drop it.
    log.warn(`generate: dropping malformed payload — ${parsed.error}`);
    return undefined;
  }

  const payload = parsed.value;
  return {
    deps,
    payload,
    target: getBriefTarget(payload),
    projection: createGenerationProjection(deps.handle, payload.ctx),
    run: { leaveRow: false, providerCalls: 0 },
    log: log.child({
      prId: String(payload.pullRequestId),
      headSha: payload.headSha,
    }),
    job: helpers?.job,
    shutdownSignal: helpers?.abortSignal,
    pool,
  };
}

/** Every failure, the recovery job's claim check included, settles in one place. */
async function runJob(
  start: RunStart,
  work: (progress: RunProgress) => Promise<void>,
): Promise<void> {
  const progress: RunProgress = {};
  try {
    await work(progress);
  } catch (error) {
    await settleFailedRun(start, error, progress);
  }
}

/**
 * A lost claim stands down without a write, the row is the new holder's or
 * gone with its pull request; a stored-brief run the cap refused settles the
 * row it stands on; a supersession is terminal `superseded`; a shutdown abort
 * releases the claim and rethrows so graphile returns the job to the queue,
 * or, on the job's last attempt, ends the run as attempts spent; anything
 * else is a failure, swallowed when permanent or when its fenced write finds
 * the claim lost, and rethrown for graphile's retry otherwise. Only a failure
 * no retry follows posts the failed Entry.
 */
async function settleFailedRun(
  start: RunStart,
  error: unknown,
  progress: RunProgress,
): Promise<void> {
  const { projection, target, run, log } = start;
  if (error instanceof ClaimLostSignal) {
    log.warn(`generate: standing down, ${error.message}`);
    return;
  }
  if (error instanceof SpendCappedSignal) {
    if (progress.context !== undefined) {
      await settleStoredBriefRun(progress.context);
    }
    return;
  }
  if (error instanceof SupersededSignal) {
    await markRunSuperseded(start);
    log.info(`generate: superseded (${error.message})`);
    return;
  }
  let failure = error;
  if (start.shutdownSignal?.aborted === true) {
    if (isRetriedAfterShutdown(start)) {
      await releaseClaimOnShutdown(start);
      log.info("generate: aborted by shutdown — job returns to the queue");
      throw error;
    }
    log.warn("generate: shutdown on the job's last attempt, the run ends");
    failure = new TransientJobError("shutdown on the job's last attempt", {
      cause: error,
      failure: { code: GenerationFailureCodes.ATTEMPTS_EXHAUSTED },
    });
  }

  const report = await reportJobFailure(failure, {
    deps: start.deps,
    projection,
    target,
    leaveRow: run.leaveRow,
    runId: run.runId,
    recovering: start.recovering,
    job: start.job,
    queueEntrySync: () => queueEntrySync(start),
    log,
  });
  const { outcome } = report;
  if (report.rowKept) {
    run.leaveRow = true;
  }
  const endsFailed =
    outcome === JobFailureOutcomes.PERMANENT ||
    outcome === JobFailureOutcomes.LAST_ATTEMPT;
  if (endsFailed) {
    await announceFailedRun(start, report, progress);
    if (progress.context !== undefined) {
      await scheduleMovedHeadAfterPinnedRun(progress.context);
    }
  }
  const retried =
    outcome === JobFailureOutcomes.RETRYING ||
    outcome === JobFailureOutcomes.LAST_ATTEMPT;
  if (retried) {
    throw failure;
  }
}

/**
 * A shutdown leaves the run to a retry: graphile's next attempt of this job,
 * or, for a takeover, the head's recovery job its claim queued. On the job's
 * last attempt no retry follows, so the run ends there instead.
 */
function isRetriedAfterShutdown(start: RunStart): boolean {
  return !isFinalRunAttempt(start);
}

/**
 * A failure no retry follows ends the run `failed` and posts the failed
 * Entry; a run over the stored brief settles the row instead, and an
 * unclaimed recovery's row is `endUnclaimedRecovery`'s to end.
 */
async function announceFailedRun(
  start: RunStart,
  report: JobFailureReport,
  progress: RunProgress,
): Promise<void> {
  const { run } = start;
  if (run.standsOnStoredBrief === true) {
    if (progress.context !== undefined) {
      await settleStoredBriefRun(progress.context);
    }
    return;
  }
  const recoveryUnclaimed =
    start.recovering && run.leaveRow && run.runId === undefined;
  if (!recoveryUnclaimed) {
    if (!run.leaveRow) {
      await postFailedEntry(progress, report.failure.code);
    }
    return;
  }

  const code = await endUnclaimedRecovery(start, selectRecoveryFailure(report));
  if (code !== undefined) {
    await postFailedEntry(progress, code);
  }
}

function selectRecoveryFailure(report: JobFailureReport): GenerationFailure {
  if (report.outcome === JobFailureOutcomes.LAST_ATTEMPT) {
    return { code: GenerationFailureCodes.ATTEMPTS_EXHAUSTED };
  }
  return report.failure;
}

/**
 * The released claim stays counted against the head's attempts. A takeover's
 * release hands the row to the head's recovery job, which carries its retry.
 */
async function releaseClaimOnShutdown(start: RunStart): Promise<void> {
  const { projection, target, run, recovering, log } = start;
  if (run.runId === undefined || run.attempt === undefined) {
    return;
  }

  await projection.releaseClaim(target, run.runId, {
    awaitsRecovery: recovering,
  });
  log.warn(
    "generate: claim released on shutdown, the attempt still counts",
    buildAttemptFields(run.attempt),
  );
}

async function markRunSuperseded(start: RunStart): Promise<void> {
  const { projection, target, run } = start;
  if (run.runId !== undefined) {
    await projection.finishRun(target, run.runId, {
      status: GenerationStatuses.SUPERSEDED,
    });
    return;
  }
  if (!run.leaveRow) {
    await projection.markSuperseded(target);
    return;
  }
  if (start.recovering) {
    await supersedeUnclaimedRecovery(start);
  }
}

async function runGeneration(
  start: RunStart,
  progress: RunProgress,
): Promise<void> {
  const context = await traceRunStep(
    "generation.open",
    [start.shutdownSignal],
    async (span) => {
      const opened = await openRun(start, progress);
      span.setAttributes({ "mergebrief.opened": opened !== undefined });
      return opened;
    },
  );
  if (context === undefined) {
    return;
  }
  progress.context = context;
  const authorGate = await applyAuthorGate(context);
  if (authorGate.kind === AuthorGateKinds.AWAITING_TRIGGER) {
    return;
  }
  const conditions = await applyConditionCheck(context, authorGate.repoConfig);
  if (conditions.kind === ConditionCheckKinds.HELD) {
    return;
  }
  const routed = await traceRunStep(
    "generation.route",
    listRunStops(context),
    async (span) => {
      const moved = await routeRunToLargePool(context);
      span.setAttributes({
        "mergebrief.pool": context.pool,
        "mergebrief.routed": moved,
      });
      return moved;
    },
  );
  if (routed) {
    return;
  }

  const decision = await traceRunStep(
    "generation.decide",
    listRunStops(context),
    async (span) => {
      const decided = await decideRun(context);
      span.setAttributes({ "mergebrief.decision": decided.kind });
      return decided;
    },
  );
  if (decision.kind === RunDecisionKinds.CAPPED) {
    if (decision.storedBrief !== undefined) {
      await postOwedReadyEntry(context, decision.storedBrief.headIndex);
      await settleStoredBriefRun(context);
    }
    return;
  }
  if (decision.kind === RunDecisionKinds.STAND_DOWN) {
    return;
  }
  await generateUnderWatch(context, decision, conditions);
}

/**
 * The generator aborts on any trigger: a superseding push or a lost claim
 * (the watch), or graceful shutdown. `settleFailedRun` tells them apart. The
 * poller aborting an in-flight call surfaces as that call's rejection; that
 * is the watch's reason, not a failure.
 */
async function generateUnderWatch(
  context: RunContext,
  decision: GeneratingRun,
  reads: PreClaimReads,
): Promise<void> {
  const { deps, watch, shutdownSignal } = context;
  const generatorSignal =
    shutdownSignal === undefined
      ? watch.signal
      : AbortSignal.any([watch.signal, shutdownSignal]);
  const bound = bindAbortSignal(deps.generator, generatorSignal);
  const traced = traceProviderCalls(bound, generatorSignal);
  const generator = countProviderCalls(traced, context.run);
  try {
    await generateArtifacts(context, decision, generator, reads);
  } catch (error) {
    const outcome = resolveWatchOutcome(watch, error);
    if (outcome instanceof SupersededSignal) {
      await scheduleUrlBoxRegenerationIfMoved(context, watch.getObserved());
    }
    throw outcome;
  } finally {
    watch.stop();
  }
}

function countProviderCalls(generator: Generator, run: RunState): Generator {
  return {
    generate: async (req) => {
      run.providerCalls += 1;
      return generator.generate(req);
    },
    origin: (effort) => generator.origin(effort),
  };
}

function resolveWatchOutcome(
  watch: SupersessionWatch,
  error: unknown,
): unknown {
  const watchEndedRun = watch.signal.aborted && !isRunSignal(error);
  if (!watchEndedRun) {
    return error;
  }
  const reason: unknown = watch.signal.reason;
  if (reason instanceof ClaimLostSignal) {
    return reason;
  }
  return new SupersededSignal("head advanced mid-call (streaming poll)");
}

async function generateArtifacts(
  context: RunContext,
  decision: GeneratingRun,
  generator: Generator,
  reads: PreClaimReads,
): Promise<void> {
  const stops = listRunStops(context);
  const inputs = await traceRunStep("generation.inputs", stops, () =>
    prepareRunInputs(context, decision, reads),
  );
  context.run.entryCommentAllowed = inputs.entryCommentAllowed;
  const brief = await traceRunStep("brief.generate", stops, () =>
    produceBrief(context, decision, inputs, generator),
  );
  // The ready Entry lands before the slower revision and delta work.
  await traceRunStep("entry.ready", stops, () =>
    postReadyEntry(
      context,
      inputs.entryCommentAllowed,
      brief.briefRef.headIndex,
    ),
  );
  await writeFollowOnArtifacts(context, inputs, brief, generator);
  await traceRunStep("generation.finish", stops, () =>
    finishRun(context, brief.briefRef),
  );
  await scheduleMovedHeadAfterPinnedRun(context);
}

/**
 * A pinned run ended, succeeded or failed for good, on a head that moved
 * under it; the installation's push webhook queued the newer head, a url-box
 * PR has none, so the observed head is scheduled here as every supersession
 * path schedules it. A retried failure leaves it to the retry's PR read.
 */
async function scheduleMovedHeadAfterPinnedRun(
  context: RunContext,
): Promise<void> {
  const observed = context.watch.getObserved();
  if (observed === undefined) {
    return;
  }
  await scheduleUrlBoxRegenerationIfMoved(context, observed);
}
