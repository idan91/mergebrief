// `createApp` requires a logger (BRIEF-51); cli suites never assert on log
// output, so inject a silent one. Dev-only — the bundle never imports this.
import { createLogger, type Logger } from "logging";

export function testLogger(): Logger {
  return createLogger({ env: {}, destination: { write: () => {} } });
}
