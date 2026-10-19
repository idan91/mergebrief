import type { Generator } from "generators";
import type { Logger } from "logging";
import { createGenerationProjection } from "persistence";
import { GenerationStatuses } from "types/generations";
import { parseGeneratePayload } from "../payload";
import { shouldRecoverClaim } from "./logic/claim-recovery";
import { reportJobFailure } from "./logic/job-failure";
import { postOwedReadyEntry, postReadyEntry } from "./logic/ready-entry";
import {
  finishRun,
  produceBrief,
  writeFollowOnArtifacts,
} from "./logic/run-artifacts";
import {
  openRun,
  scheduleUrlBoxRegenerationIfMoved,
} from "./logic/run-context";
import { decideRun } from "./logic/run-decision";
import { prepareRunInputs } from "./logic/run-inputs";
import { SpendCappedSignal } from "./logic/spend-gate";
import {
  bindAbortSignal,
  ClaimLostSignal,
  SupersededSignal,
} from "./logic/supersession-watch";
import {
  RunDecisionKinds,
  type GenerateTask,
  type GenerateTaskDeps,
  type GenerateTaskHelpers,
  type GeneratingRun,
  type RunContext,
  type RunStart,
  type RunState,
  type SupersessionWatch,
} from "./types";
import { buildAttemptFields, getBriefTarget, createNoopLogger } from "./utils";

export type { GenerateTaskDeps } from "./types";

/**
 * Build the generate task. The returned function is graphile's `Task` shape;
 * tests call it directly with a payload (helpers optional).
 */
export function createGenerateTask(deps: GenerateTaskDeps): GenerateTask {
  const log = deps.log ?? createNoopLogger();

  return async function generate(
    rawPayload: unknown,
    helpers?: GenerateTaskHelpers,
  ): Promise<void> {
    const start = buildRunStart(deps, log, rawPayload, helpers);
    if (start === undefined) {
      return;
    }
    const run: RunStart = { ...start, recovering: false };
    await runJob(run, async () => runGeneration(run));
  };
}

/**
 * Build the recovery task, queued per head when a run claims it. It does
 * nothing unless the claim's lease lapsed with the run unfinished, then runs
 * the head as `generate` does, claiming the row even over a stored brief; a
 * retry is that run's retry.
 */
export function createRecoverGenerationTask(
  deps: GenerateTaskDeps,
): GenerateTask {
  const log = deps.log ?? createNoopLogger();

  return async function recoverGeneration(
    rawPayload: unknown,
    helpers?: GenerateTaskHelpers,
  ): Promise<void> {
    const opened = buildRunStart(deps, log, rawPayload, helpers);
    if (opened === undefined) {
      return;
    }
    const start: RunStart = { ...opened, recovering: true };
    // Nothing before the run decision may mark the row.
    start.run.leaveRow = true;
    const isRetry = (helpers?.job?.attempts ?? 1) > 1;
    await runJob(start, async () => {
      if (await shouldRecoverClaim(start, isRetry)) {
        await runGeneration(start);
      }
    });
  };
}

function buildRunStart(
  deps: GenerateTaskDeps,
  log: Logger,
  rawPayload: unknown,
  helpers: GenerateTaskHelpers | undefined,
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
  };
}

/** Every failure, the recovery job's claim check included, settles in one place. */
async function runJob(
  start: RunStart,
  work: () => Promise<void>,
): Promise<void> {
  try {
    await work();
  } catch (error) {
    await settleFailedRun(start, error);
  }
}

/**
 * A lost claim stands down without a write, the row is the new holder's or
 * gone with its pull request; a stored-brief run the cap refused stands down
 * too, its row as found; a supersession is terminal `superseded`; a shutdown
 * abort releases the claim and rethrows so graphile returns the job to the
 * queue; anything else is a failure, swallowed when permanent or when its
 * fenced write finds the claim lost, and rethrown for graphile's retry
 * otherwise.
 */
async function settleFailedRun(start: RunStart, error: unknown): Promise<void> {
  const { projection, target, run, log } = start;
  if (error instanceof ClaimLostSignal) {
    log.warn(`generate: standing down, ${error.message}`);
    return;
  }
  if (error instanceof SpendCappedSignal) {
    return;
  }
  if (error instanceof SupersededSignal) {
    await markRunSuperseded(start);
    log.info(`generate: superseded (${error.message})`);
    return;
  }
  if (start.shutdownSignal?.aborted === true) {
    await releaseClaimOnShutdown(start);
    log.info("generate: aborted by shutdown — job returns to the queue");
    throw error;
  }

  const jobEnds = await reportJobFailure(error, {
    deps: start.deps,
    projection,
    target,
    leaveRow: run.leaveRow,
    runId: run.runId,
    job: start.job,
    log,
  });
  if (!jobEnds) {
    throw error;
  }
}

/** The released claim stays counted against the head's attempts. */
async function releaseClaimOnShutdown(start: RunStart): Promise<void> {
  const { projection, target, run, log } = start;
  if (run.runId === undefined || run.attempt === undefined) {
    return;
  }

  await projection.releaseClaim(target, run.runId);
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
  }
}

async function runGeneration(start: RunStart): Promise<void> {
  const context = await openRun(start);
  if (context === undefined) {
    return;
  }

  const decision = await decideRun(context);
  if (decision.kind === RunDecisionKinds.CAPPED) {
    if (decision.storedBrief !== undefined) {
      await postOwedReadyEntry(context, decision.storedBrief.headIndex);
    }
    return;
  }
  if (decision.kind === RunDecisionKinds.STAND_DOWN) {
    return;
  }
  await generateUnderWatch(context, decision);
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
): Promise<void> {
  const { deps, watch, shutdownSignal } = context;
  const generatorSignal =
    shutdownSignal === undefined
      ? watch.signal
      : AbortSignal.any([watch.signal, shutdownSignal]);
  const generator = countProviderCalls(
    bindAbortSignal(deps.generator, generatorSignal),
    context.run,
  );
  try {
    await generateArtifacts(context, decision, generator);
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
  const signalled =
    error instanceof SupersededSignal ||
    error instanceof ClaimLostSignal ||
    error instanceof SpendCappedSignal;
  if (signalled || !watch.signal.aborted) {
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
): Promise<void> {
  const inputs = await prepareRunInputs(context, decision);
  const brief = await produceBrief(context, decision, inputs, generator);
  // The ready Entry lands before the slower revision and delta work.
  await postReadyEntry(
    context,
    inputs.entryCommentAllowed,
    brief.briefRef.headIndex,
  );
  await writeFollowOnArtifacts(context, inputs, brief, generator);
  await finishRun(context, brief.briefRef);
}
