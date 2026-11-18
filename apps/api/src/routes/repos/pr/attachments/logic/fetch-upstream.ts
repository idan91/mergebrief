export interface UpstreamDeadline {
  readonly init: RequestInit;
  /** The client's request signal: a disconnect cancels the upstream, body included. */
  readonly signal: AbortSignal;
  /** Until the upstream's headers arrive; the body then streams at the reader's pace. */
  readonly timeoutMs: number;
}

export interface CallDeadline {
  /** The client's request signal; absent where several requests wait on the one call. */
  readonly signal?: AbortSignal | undefined;
  readonly timeoutMs: number;
}

/** `run` under one signal that aborts at the deadline or when the client goes away; the timer stops once `run` settles. */
export async function runWithDeadline<Value>(
  deadline: CallDeadline,
  run: (signal: AbortSignal) => Promise<Value>,
): Promise<Value> {
  const timeout = new AbortController();
  const timer = setTimeout(() => {
    timeout.abort();
  }, deadline.timeoutMs);
  const signals = [timeout.signal];
  if (deadline.signal !== undefined) {
    signals.push(deadline.signal);
  }
  try {
    return await run(AbortSignal.any(signals));
  } finally {
    clearTimeout(timer);
  }
}

/** One upstream request that gives up at the deadline or when the client goes away. */
export function fetchWithHeadersDeadline(
  fetchImpl: typeof fetch,
  url: string | URL,
  { init, signal, timeoutMs }: UpstreamDeadline,
): Promise<Response> {
  return runWithDeadline({ signal, timeoutMs }, (combined) =>
    fetchImpl(url, { ...init, signal: combined }),
  );
}
