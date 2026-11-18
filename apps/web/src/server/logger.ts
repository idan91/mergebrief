// The web process's ONE logger: built lazily from the ambient env and shared
// by the server entry, the webhook composition, and the server-only feature
// modules. Everything logs through the `packages/logging` boundary; pino never
// appears outside it.
import "@tanstack/react-start/server-only";

import { createLogger, type Logger } from "logging";
import { getServerEnv } from "./env";

let cached: Logger | undefined;

export function getServerLogger(): Logger {
  if (cached === undefined) {
    cached = createLogger({ env: getServerEnv() });
  }
  return cached;
}
