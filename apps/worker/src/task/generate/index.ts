import type { Generator } from "generators";
import { createGenerationProjection } from "persistence";
import { parseGeneratePayload } from "../payload";
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
import { bindAbortSignal, SupersededSignal } from "./logic/supersession-watch";
import {
  RunDecisionKinds,
  type GenerateTask,
  type GenerateTaskDeps,
  type GenerateTaskHelpers,
  type GeneratingRun,
  type RunContext,
  type RunStart,
} from "./types";
import { getBriefTarget, createNoopLogger } from "./utils";

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
    const parsed = parseGeneratePayload(rawPayload);
    if (!parsed.ok) {
      // Poisoned/foreign job: no projection row is addressable, drop it.
      log.warn(`generate: dropping malformed payload — ${parsed.error}`);
      return;
    }

    const payload = parsed.value;
    const start: RunStart = {
      deps,
      payload,
      target: getBriefTarget(payload),
      projection: createGenerationProjection(deps.handle, payload.ctx),
      run: { leaveRow: false },
      log: log.child({
        prId: String(payload.pullRequestId),
        headSha: payload.headSha,
      }),
      job: helpers?.job,
      shutdownSignal: helpers?.abortSignal,
    };
    try {
      await runGeneration(start);
    } catch (error) {
      await settleFailedRun(start, error);
    }
  };
}

/**
 * A supersession is terminal `superseded`; a shutdown abort leaves the row
 * and rethrows so graphile returns the job to the queue; anything else is a
 * failure, swallowed when permanent and rethrown for graphile's retry.
 */
async function settleFailedRun(start: RunStart, error: unknown): Promise<void> {
  const { projection, target, run, log } = start;
  if (error instanceof SupersededSignal) {
    if (!run.leaveRow) {
      await projection.markSuperseded(target);
    }
    log.info(`generate: superseded (${error.message})`);
    return;
  }
  if (start.shutdownSignal?.aborted === true) {
    log.info("generate: aborted by shutdown — job returns to the queue");
    throw error;
  }

  const permanent = await reportJobFailure(error, {
    deps: start.deps,
    projection,
    target,
    leaveRow: run.leaveRow,
    job: start.job,
    log,
  });
  if (!permanent) {
    throw error;
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
  await generateUnderWatch(context, decision);
}

/**
 * The generator aborts on either trigger: a superseding push (the watch) or
 * graceful shutdown. `settleFailedRun` tells the two apart. The poller
 * aborting an in-flight call surfaces as that call's rejection; that is the
 * supersession, not a failure.
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
  const generator = bindAbortSignal(deps.generator, generatorSignal);
  try {
    await generateArtifacts(context, decision, generator);
  } catch (error) {
    const abortedMidCall =
      watch.signal.aborted && !(error instanceof SupersededSignal);
    const outcome = abortedMidCall
      ? new SupersededSignal("head advanced mid-call (streaming poll)")
      : error;
    if (outcome instanceof SupersededSignal) {
      await scheduleUrlBoxRegenerationIfMoved(context, watch.getObserved());
    }
    throw outcome;
  } finally {
    watch.stop();
  }
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
  await finishRun(context);
}
