// The web process's ONE logger (BRIEF-51, ADR 0034): built lazily from the
// ambient env (after the optional `.env` load — same posture as the other
// startup-wiring reads) and shared by the server entry, the webhook
// composition, and the server-only feature modules. Everything logs through
// the `packages/logging` boundary; pino never appears outside it.
import "@tanstack/react-start/server-only";

import { createLogger, type Logger } from "logging";

let cached: Logger | undefined;

/**
 * Load `apps/web/.env` if present (mirrors `webhookApp.ts`'s `readEnv`) so
 * `LOG_LEVEL`/`NODE_ENV` from the file are honored no matter which module
 * touches the logger first.
 */
function readEnv(): NodeJS.ProcessEnv {
  try {
    process.loadEnvFile();
  } catch {
    // No .env file — the vars may still be set in the ambient env.
  }
  return process.env;
}

export function getServerLogger(): Logger {
  if (cached === undefined) {
    cached = createLogger({ env: readEnv() });
  }
  return cached;
}
