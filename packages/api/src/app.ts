// The Hono app factory (BRIEF-2 stage 4). Dependencies are INJECTED: tests
// pass a PGlite `AppDatabase` + a test secret; the composition root (the
// `apps/web` catch-all mount, stage 5) passes `createDb(DATABASE_URL)` + the
// Zod-parsed `GITHUB_WEBHOOK_SECRET`. This module never reads `process.env`
// and never constructs a DB — same injection discipline as `loadConfig`.
//
// Routes here: the webhook trust boundary only. OAuth login/callback/logout
// and the authenticated read API are PR C.
import { Hono } from "hono";
import type { AppDatabase } from "persistence";
import { webhookRoute } from "./routes/webhook";

export interface AppDeps {
  readonly handle: AppDatabase;
  readonly webhookSecret: string;
}

/** Build the API app over injected deps. */
export function createApp(deps: AppDeps): Hono {
  const app = new Hono();
  app.route("/", webhookRoute(deps));
  return app;
}
