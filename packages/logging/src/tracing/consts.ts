/** What a stop waits for the last batch before it gives up on the collector. */
export const STOP_BUDGET_MS = 5_000;

/** One export attempt's cap, inside the stop budget. */
export const EXPORT_TIMEOUT_MS = 4_000;

export const TRACES_PATH = "/v1/traces";

/** Probes, not traffic: a 15s healthcheck would otherwise be most spans. */
export const UNTRACED_PATHS: ReadonlySet<string> = new Set([
  "/healthz",
  "/readyz",
]);

export const REDACTED_VALUE = "[redacted]";
