import { Worker } from "node:worker_threads";
import {
  SpanRunnerError,
  type BuiltSpanPlan,
  type PrSpan,
  type PrSpanRunner,
} from "brief-core/pr-span";
import type { Logger } from "logging";
import {
  MAX_THREAD_RESPAWN_BACKOFF_MS,
  STOPS_BEFORE_RESPAWN_BACKOFF,
  THREAD_ANSWER_LIMIT_MS,
  THREAD_RESPAWN_BACKOFF_MS,
  THREAD_START_ALLOWANCE_MS,
} from "./consts";
import { SpanStepAnswerSchema } from "./schemas";
import {
  SpanStepAnswerKinds,
  SpanStepKinds,
  type SpanStep,
  type SpanStepAnswer,
  type SpanStepRequest,
  type SpanThread,
  type SpanThreadData,
  type SpanThreadOptions,
} from "./types";

const THREAD_ENTRY = new URL("./entry.ts", import.meta.url);

/** The thread stopped or answered out of shape: infrastructure, never a verdict on the PR. */
export class SpanThreadError extends SpanRunnerError {
  override readonly name = "SpanThreadError";
}

interface PendingStep {
  readonly request: SpanStepRequest;
  readonly resolve: (answer: SpanStepAnswer) => void;
  readonly reject: (reason: unknown) => void;
}

/** One step in flight at a time, so a queued step whose request aborted is never sent. */
interface ThreadState {
  readonly entry: URL;
  readonly lineDiffTimeoutMs: number | undefined;
  readonly answerLimitMs: number;
  readonly respawnBackoffMs: number;
  thread: Worker | undefined;
  inFlight: PendingStep | undefined;
  answerTimer: NodeJS.Timeout | undefined;
  readonly queue: PendingStep[];
  nextId: number;
  /** Stops since the last good answer; from the second, a restart waits. */
  stopsInARow: number;
  restartAllowedAt: number;
  readonly log: Logger | undefined;
}

/** A stop's cause as a log field: an error rides `err`, an exit code or reason rides `cause`. */
function shapeStopCause(cause: unknown): Record<string, unknown> {
  return cause instanceof Error ? { err: cause } : { cause: String(cause) };
}

function failPendingSteps(
  state: ThreadState,
  thread: Worker,
  cause: unknown,
): void {
  if (state.thread !== thread) {
    return;
  }
  const pending = [state.inFlight, ...state.queue.splice(0)];
  clearTimeout(state.answerTimer);
  state.thread = undefined;
  state.inFlight = undefined;
  for (const step of pending) {
    step?.reject(new SpanThreadError("the span thread stopped", { cause }));
  }
}

/** The thread failed on its own: its work fails, and a run of such stops delays the next start. */
function stopFailedThread(
  state: ThreadState,
  thread: Worker,
  cause: unknown,
): void {
  if (state.thread !== thread) {
    return;
  }
  state.stopsInARow += 1;
  const doublings = Math.max(
    state.stopsInARow - STOPS_BEFORE_RESPAWN_BACKOFF,
    0,
  );
  const backoffMs =
    state.stopsInARow < STOPS_BEFORE_RESPAWN_BACKOFF
      ? 0
      : state.respawnBackoffMs * 2 ** doublings;
  state.restartAllowedAt =
    Date.now() + Math.min(backoffMs, MAX_THREAD_RESPAWN_BACKOFF_MS);
  state.log?.warn("span thread stopped; its steps failed", {
    stopsInARow: state.stopsInARow,
    ...shapeStopCause(cause),
  });
  failPendingSteps(state, thread, cause);
  void thread.terminate();
}

function receiveAnswer(
  state: ThreadState,
  thread: Worker,
  message: unknown,
): void {
  if (state.thread !== thread) {
    return;
  }
  const pending = state.inFlight;
  state.inFlight = undefined;
  clearTimeout(state.answerTimer);
  thread.unref();

  const answer = SpanStepAnswerSchema.safeParse(message);
  const isMalformed = !answer.success || answer.data.id !== pending?.request.id;
  if (isMalformed) {
    const fields = answer.success
      ? { reason: "id-mismatch" }
      : { err: answer.error };
    state.log?.error("span step answer malformed", fields);
    pending?.reject(new SpanThreadError("the span step answer is malformed"));
    sendNextStep(state);
    return;
  }
  state.stopsInARow = 0;
  pending.resolve(answer.data);
  sendNextStep(state);
}

function spawnThread(state: ThreadState): Worker {
  // No flags: the process's `--import` preloads (tracing, config) would run
  // again in the thread. No env: no secret reaches it.
  const threadData: SpanThreadData = {
    lineDiffTimeoutMs: state.lineDiffTimeoutMs,
  };
  const thread = new Worker(state.entry, {
    execArgv: [],
    env: {},
    workerData: threadData,
  });
  thread.on("message", (message: unknown) => {
    receiveAnswer(state, thread, message);
  });
  thread.on("messageerror", (error) => {
    stopFailedThread(state, thread, error);
  });
  thread.on("error", (error) => {
    stopFailedThread(state, thread, error);
  });
  thread.on("exit", (exitCode) => {
    stopFailedThread(state, thread, exitCode);
  });
  return thread;
}

function sendNextStep(state: ThreadState): void {
  const next = state.inFlight === undefined ? state.queue.shift() : undefined;
  if (next === undefined) {
    return;
  }
  const thread = state.thread ?? spawnThread(state);
  state.thread = thread;
  state.inFlight = next;
  // Held only while a step is in flight, so an idle thread never keeps the process alive.
  thread.ref();
  // A worker thread's postMessage takes no target origin; the rule reads window's.
  // oxlint-disable-next-line unicorn/require-post-message-target-origin
  thread.postMessage(next.request);
  state.answerTimer = setTimeout(() => {
    stopFailedThread(state, thread, "no answer in time");
  }, state.answerLimitMs);
}

async function enqueueStep(
  state: ThreadState,
  step: SpanStep,
  signal: AbortSignal,
): Promise<SpanStepAnswer> {
  signal.throwIfAborted();
  const isRestartWaiting =
    state.thread === undefined && Date.now() < state.restartAllowedAt;
  if (isRestartWaiting) {
    throw new SpanThreadError("the span thread is restarting");
  }
  const settled = Promise.withResolvers<SpanStepAnswer>();
  const request: SpanStepRequest = { id: state.nextId, step };
  state.nextId += 1;

  function dropOnAbort(): void {
    const queued = state.queue.indexOf(pending);
    if (queued !== -1) {
      state.queue.splice(queued, 1);
    }
    settled.reject(signal.reason);
  }
  const pending: PendingStep = {
    request,
    resolve: (answer) => {
      signal.removeEventListener("abort", dropOnAbort);
      settled.resolve(answer);
    },
    reject: (reason) => {
      signal.removeEventListener("abort", dropOnAbort);
      settled.reject(reason);
    },
  };
  signal.addEventListener("abort", dropOnAbort, { once: true });

  state.queue.push(pending);
  sendNextStep(state);
  return await settled.promise;
}

function failOutOfShape(
  answer: SpanStepAnswer,
  log: Logger | undefined,
): never {
  log?.error("span step answer malformed", {
    reason: "wrong-kind",
    kind: answer.kind,
  });
  throw new SpanThreadError("the span step answer is malformed");
}

function readPlan(
  answer: SpanStepAnswer,
  log: Logger | undefined,
): BuiltSpanPlan {
  return answer.kind === SpanStepAnswerKinds.PLAN
    ? answer.plan
    : failOutOfShape(answer, log);
}

function readSpan(answer: SpanStepAnswer, log: Logger | undefined): PrSpan {
  return answer.kind === SpanStepAnswerKinds.SPAN
    ? answer.span
    : failOutOfShape(answer, log);
}

function readPatch(
  answer: SpanStepAnswer,
  log: Logger | undefined,
): string | undefined {
  if (answer.kind === SpanStepAnswerKinds.PATCH) {
    return answer.patch;
  }
  return answer.kind === SpanStepAnswerKinds.NO_PATCH
    ? undefined
    : failOutOfShape(answer, log);
}

function createThreadRunner(state: ThreadState): PrSpanRunner {
  async function runStep(step: SpanStep, signal: AbortSignal) {
    return enqueueStep(state, step, signal);
  }
  const { log } = state;
  return {
    async planBuiltSpan(input, signal) {
      const step: SpanStep = { kind: SpanStepKinds.PLAN_BUILT_SPAN, input };
      return readPlan(await runStep(step, signal), log);
    },
    async buildPrSpan(input, signal) {
      const step: SpanStep = { kind: SpanStepKinds.BUILD_PR_SPAN, input };
      return readSpan(await runStep(step, signal), log);
    },
    async buildFastForwardSpan(input, signal) {
      const step: SpanStep = {
        kind: SpanStepKinds.BUILD_FAST_FORWARD_SPAN,
        input,
      };
      return readSpan(await runStep(step, signal), log);
    },
    async runLineDiff(input, signal) {
      const step: SpanStep = { kind: SpanStepKinds.LINE_DIFF, input };
      return readPatch(await runStep(step, signal), log);
    },
  };
}

async function terminateThread(state: ThreadState): Promise<void> {
  const thread = state.thread;
  if (thread === undefined) {
    return;
  }
  failPendingSteps(state, thread, "terminated");
  await thread.terminate();
}

/**
 * Runs the span's steps off the event loop, through the same brief-core
 * functions and bounds the worker runs in-process, so the span is the
 * worker's. Only infrastructure rejects, with `SpanThreadError`: a thread
 * that stops or misses its answer limit is stopped with its work, and the
 * next step starts a new one, after a doubling wait from the second stop in
 * a row. An aborted request rejects with its reason at once; the step in
 * flight runs to its end.
 */
export function createSpanThread(options: SpanThreadOptions = {}): SpanThread {
  const { lineDiffTimeoutMs } = options;
  const defaultAnswerLimitMs =
    lineDiffTimeoutMs === undefined
      ? THREAD_ANSWER_LIMIT_MS
      : lineDiffTimeoutMs + THREAD_START_ALLOWANCE_MS;

  const state: ThreadState = {
    entry: options.entry ?? THREAD_ENTRY,
    lineDiffTimeoutMs,
    answerLimitMs: options.answerLimitMs ?? defaultAnswerLimitMs,
    respawnBackoffMs: options.respawnBackoffMs ?? THREAD_RESPAWN_BACKOFF_MS,
    thread: undefined,
    inFlight: undefined,
    answerTimer: undefined,
    queue: [],
    nextId: 0,
    stopsInARow: 0,
    restartAllowedAt: 0,
    log: options.log,
  };
  return {
    runner: createThreadRunner(state),
    terminate: () => terminateThread(state),
  };
}
