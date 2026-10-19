import { traceStep, type SpanHandle } from "logging";
import { SpendCappedSignal } from "./spend-gate";
import { ClaimLostSignal, SupersededSignal } from "./supersession-watch";

/** The ends a run takes by design: a newer push, a lost claim, the cap. */
const RUN_SIGNALS = [SupersededSignal, ClaimLostSignal, SpendCappedSignal];

export function isRunSignal(error: unknown): boolean {
  return RUN_SIGNALS.some((signal) => error instanceof signal);
}

/**
 * Whether a step's throw is a failure: not when the run ended by design, and
 * not when one of `stops` (the supersession watch, shutdown) aborted it.
 */
export function buildStepFailureCheck(
  stops: readonly (AbortSignal | undefined)[],
): (error: unknown) => boolean {
  return (error) => {
    if (isRunSignal(error)) {
      return false;
    }
    const stopped = stops.some((signal) => signal?.aborted === true);
    return !stopped;
  };
}

/** A worker step's span, failed only on a throw the run did not choose. */
export function traceRunStep<Outcome>(
  name: string,
  stops: readonly (AbortSignal | undefined)[],
  run: (span: SpanHandle) => Promise<Outcome>,
): Promise<Outcome> {
  const isFailure = buildStepFailureCheck(stops);
  return traceStep(name, {}, run, { isFailure });
}

interface RunStopSources {
  readonly watch: { readonly signal: AbortSignal };
  readonly shutdownSignal: AbortSignal | undefined;
}

/** The run's abort sources: its supersession watch and the worker's shutdown. */
export function listRunStops(
  context: RunStopSources,
): (AbortSignal | undefined)[] {
  return [context.watch.signal, context.shutdownSignal];
}
