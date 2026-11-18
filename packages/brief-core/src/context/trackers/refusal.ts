import type { ConfigError } from "generators";

/** A tracker refusing to build its read for this root: the same shape the generator registry refuses with. */
export function refuseTrackerRead(issues: readonly string[]): {
  ok: false;
  error: ConfigError;
} {
  return {
    ok: false,
    error: {
      code: "invalid",
      message: "invalid tracker configuration",
      issues,
    },
  };
}
