// The Hono app factory (BRIEF-2 stage 4 + stage 6). Dependencies are INJECTED:
// tests pass a PGlite `AppDatabase` + secrets/stubs; the composition root (the
// `apps/web` catch-all mount) passes `createDb(DATABASE_URL)` + the Zod-parsed
// GitHub config + the crypto key provider. This module never reads
// `process.env` and never constructs a DB — same injection discipline as
// `loadConfig`.
//
// Routes here: the webhook trust boundary (stage 4) and the reviewer OAuth
// routes (stage 6). The authenticated read API is stage 7.
import { Hono } from "hono";
import type { AppDatabase } from "persistence";
import { authRoute, type AuthDeps } from "./routes/auth";
import { webhookRoute } from "./routes/webhook";

export type { AuthDeps } from "./routes/auth";

export interface AppDeps {
  readonly handle: AppDatabase;
  readonly webhookSecret: string;
  /** Reviewer-auth bundle (OAuth creds, crypto seam, cookie/redirect policy). */
  readonly auth: AuthDeps;
}

/** Build the API app over injected deps. */
export function createApp(deps: AppDeps): Hono {
  const app = new Hono();
  app.route("/", webhookRoute(deps));
  app.route("/", authRoute(deps));
  return app;
}
