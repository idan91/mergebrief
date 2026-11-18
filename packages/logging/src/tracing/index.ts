// ENTRY of `logging/tracing`: the OTel bootstrap each app's `instrument.ts`
// preload starts and its shutdown path stops. Off by default, and off means
// the SDK, the exporter and the instrumentations are never imported.
import type { Result } from "types/utils";
import { resolveTracingConfig } from "./config";
import { STOP_BUDGET_MS } from "./consts";
import {
  StopTracingOutcomes,
  TracingStatuses,
  type StartTracingOptions,
  type StopTracingOutcome,
  type TracingLog,
  type TracingStatus,
} from "./types";

export { resolveTracingConfig } from "./config";
export {
  StopTracingOutcomes,
  TraceSamplers,
  TracingStatuses,
  type StartTracingOptions,
  type StopTracingOutcome,
  type TraceSampler,
  type TracingConfig,
  type TracingLog,
  type TracingStatus,
} from "./types";

interface RunningTracer {
  shutdown(): Promise<void>;
}

// The process's one tracer: the preload starts it and the shutdown path,
// a different module, stops it.
let running: RunningTracer | undefined;

/**
 * Must run before the app imports anything it instruments: the import hook
 * only patches ES modules loaded after it is registered.
 */
export async function startTracing(
  options: StartTracingOptions,
): Promise<Result<TracingStatus, string>> {
  const config = resolveTracingConfig(options.env, options.serviceName);
  if (!config.ok) {
    return config;
  }
  if (config.value === undefined) {
    return { ok: true, value: TracingStatuses.OFF };
  }
  if (running !== undefined) {
    return { ok: true, value: TracingStatuses.ON };
  }

  const { registerImportHook } = await import("./import-hook");
  const waitForHooks = registerImportHook();
  const [{ routeDiagnostics }, { startTracerProvider }] = await Promise.all([
    import("./diagnostics"),
    import("./provider"),
  ]);
  routeDiagnostics(options.log);
  running = startTracerProvider(config.value, options);
  await waitForHooks();
  return { ok: true, value: TracingStatuses.ON };
}

/**
 * Flushes the last batch and stops, never past `budgetMs`: a collector that
 * is down must not hold a container stop open.
 */
export async function stopTracing(
  log: TracingLog,
  budgetMs = STOP_BUDGET_MS,
): Promise<StopTracingOutcome> {
  const stopping = running;
  if (stopping === undefined) {
    return StopTracingOutcomes.OFF;
  }
  running = undefined;

  let timer: NodeJS.Timeout | undefined;
  const budget = new Promise<StopTracingOutcome>((resolve) => {
    timer = setTimeout(() => resolve(StopTracingOutcomes.TIMED_OUT), budgetMs);
  });
  const shutdown = stopping.shutdown().then(
    () => StopTracingOutcomes.FLUSHED,
    () => StopTracingOutcomes.FAILED,
  );
  const outcome = await Promise.race([shutdown, budget]);
  clearTimeout(timer);

  if (outcome !== StopTracingOutcomes.FLUSHED) {
    log.warn("tracing: the last spans were not exported", { outcome });
  }
  return outcome;
}
