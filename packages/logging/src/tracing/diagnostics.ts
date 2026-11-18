import { diag, DiagLogLevel, type DiagLogFunction } from "@opentelemetry/api";
import type { TracingLog } from "./types";

function ignoreDiagnostic(): void {}

// An export failure is degraded telemetry, never an outage: both of the
// SDK's upper levels land as `warn`. An Error argument rides as `err` so the
// boundary's scrub covers it.
function forwardTo(log: TracingLog): DiagLogFunction {
  return (message, ...args) => {
    const err = args.find((arg) => arg instanceof Error);
    if (err === undefined) {
      log.warn(`tracing: ${message}`);
      return;
    }
    log.warn(`tracing: ${message}`, { err });
  };
}

export function routeDiagnostics(log: TracingLog): void {
  const warn = forwardTo(log);
  diag.setLogger(
    {
      error: warn,
      warn,
      info: ignoreDiagnostic,
      debug: ignoreDiagnostic,
      verbose: ignoreDiagnostic,
    },
    DiagLogLevel.WARN,
  );
}
