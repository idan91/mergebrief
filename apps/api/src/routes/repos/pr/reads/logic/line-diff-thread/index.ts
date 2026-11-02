import { Worker } from "node:worker_threads";
import {
  SpanRunnerError,
  type LineDiffInput,
  type LineDiffRunner,
} from "brief-core/pr-span";
import {
  MAX_THREAD_RESPAWN_BACKOFF_MS,
  STOPS_BEFORE_RESPAWN_BACKOFF,
  THREAD_ANSWER_LIMIT_MS,
  THREAD_RESPAWN_BACKOFF_MS,
} from "./consts";
import { LineDiffAnswerSchema } from "./schemas";
import {
  LineDiffAnswerKinds,
  type LineDiffRequest,
  type LineDiffThreadOptions,
} from "./types";

const THREAD_ENTRY = new URL("./entry.ts", import.meta.url);

/** The thread stopped or answered out of shape: infrastructure, never a verdict on the file. */
export class LineDiffThreadError extends SpanRunnerError {
  override readonly name = "LineDiffThreadError";
}

/** The API process's one line-diff thread, started on the first diff. */
export interface LineDiffThread {
  readonly runLineDiff: LineDiffRunner;
  /** Stops the thread: pending diffs reject, and the next diff starts a new one. */
  terminate(): Promise<void>;
}

interface PendingDiff {
  readonly request: LineDiffRequest;
  readonly resolve: (patch: string | undefined) => void;
  readonly reject: (reason: unknown) => void;
}

/** One diff in flight at a time, so a queued diff whose request aborted is never sent. */
interface ThreadState {
  readonly entry: URL;
  readonly answerLimitMs: number;
  readonly respawnBackoffMs: number;
  thread: Worker | undefined;
  inFlight: PendingDiff | undefined;
  answerTimer: NodeJS.Timeout | undefined;
  readonly queue: PendingDiff[];
  nextId: number;
  /** Stops since the last good answer; from the second, a restart waits. */
  stopsInARow: number;
  restartAllowedAt: number;
}

function failPendingDiffs(
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
  for (const diff of pending) {
    diff?.reject(
      new LineDiffThreadError("the line-diff thread stopped", { cause }),
    );
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
  failPendingDiffs(state, thread, cause);
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

  const answer = LineDiffAnswerSchema.safeParse(message);
  const isMalformed = !answer.success || answer.data.id !== pending?.request.id;
  if (isMalformed) {
    pending?.reject(
      new LineDiffThreadError("the line-diff answer is malformed"),
    );
    sendNextDiff(state);
    return;
  }
  state.stopsInARow = 0;
  if (answer.data.kind === LineDiffAnswerKinds.PATCH) {
    pending.resolve(answer.data.patch);
  } else {
    pending.resolve(undefined);
  }
  sendNextDiff(state);
}

function spawnThread(state: ThreadState): Worker {
  // No flags: the process's `--import` preloads (tracing, config) would run
  // again in the thread. No env: no secret reaches it.
  const thread = new Worker(state.entry, { execArgv: [], env: {} });
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

function sendNextDiff(state: ThreadState): void {
  const next = state.inFlight === undefined ? state.queue.shift() : undefined;
  if (next === undefined) {
    return;
  }
  const thread = state.thread ?? spawnThread(state);
  state.thread = thread;
  state.inFlight = next;
  // Held only while a diff is in flight, so an idle thread never keeps the process alive.
  thread.ref();
  // A worker thread's postMessage takes no target origin; the rule reads window's.
  // oxlint-disable-next-line unicorn/require-post-message-target-origin
  thread.postMessage(next.request);
  state.answerTimer = setTimeout(() => {
    stopFailedThread(state, thread, "no answer in time");
  }, state.answerLimitMs);
}

async function enqueueLineDiff(
  state: ThreadState,
  input: LineDiffInput,
  signal: AbortSignal,
): Promise<string | undefined> {
  signal.throwIfAborted();
  const isRestartWaiting =
    state.thread === undefined && Date.now() < state.restartAllowedAt;
  if (isRestartWaiting) {
    throw new LineDiffThreadError("the line-diff thread is restarting");
  }
  const settled = Promise.withResolvers<string | undefined>();
  const request: LineDiffRequest = { id: state.nextId, input };
  state.nextId += 1;

  function dropOnAbort(): void {
    const queued = state.queue.indexOf(diff);
    if (queued !== -1) {
      state.queue.splice(queued, 1);
    }
    settled.reject(signal.reason);
  }
  const diff: PendingDiff = {
    request,
    resolve: (patch) => {
      signal.removeEventListener("abort", dropOnAbort);
      settled.resolve(patch);
    },
    reject: (reason) => {
      signal.removeEventListener("abort", dropOnAbort);
      settled.reject(reason);
    },
  };
  signal.addEventListener("abort", dropOnAbort, { once: true });

  state.queue.push(diff);
  sendNextDiff(state);
  return await settled.promise;
}

async function terminateThread(state: ThreadState): Promise<void> {
  const thread = state.thread;
  if (thread === undefined) {
    return;
  }
  failPendingDiffs(state, thread, "terminated");
  await thread.terminate();
}

/**
 * Runs span line diffs off the event loop, through the same brief-core
 * function and bounds the worker uses, so the text is the worker's. A file
 * the bounds refuse resolves no patch. Only infrastructure rejects, with
 * `LineDiffThreadError`: a thread that stops or misses its answer limit is
 * stopped with its work, and the next diff starts a new one, after a
 * doubling wait from the second stop in a row. An aborted request rejects
 * with its reason at once; the diff in flight runs to its own time limit.
 */
export function createLineDiffThread(
  options: LineDiffThreadOptions = {},
): LineDiffThread {
  const state: ThreadState = {
    entry: options.entry ?? THREAD_ENTRY,
    answerLimitMs: options.answerLimitMs ?? THREAD_ANSWER_LIMIT_MS,
    respawnBackoffMs: options.respawnBackoffMs ?? THREAD_RESPAWN_BACKOFF_MS,
    thread: undefined,
    inFlight: undefined,
    answerTimer: undefined,
    queue: [],
    nextId: 0,
    stopsInARow: 0,
    restartAllowedAt: 0,
  };
  return {
    runLineDiff: (input, signal) => enqueueLineDiff(state, input, signal),
    terminate: () => terminateThread(state),
  };
}
