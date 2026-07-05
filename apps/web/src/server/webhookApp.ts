// The webhook composition root (BRIEF-2 stage 5). This is the ONE place the
// injected libraries are wired to real env + a real database: `apps/web` reads
// `process.env` here (mirroring `generate.server.ts`'s `loadEnv`), the `api`,
// `github`, and `persistence` packages stay env-INJECTED (they never read env
// themselves). The custom server entry (`src/server.ts`) delegates `/api/*` +
// `/auth/*` to the Hono app this module builds.
import "@tanstack/react-start/server-only";

import { createApp, migrateQueue } from "api";
import { loadConfig as loadGitHubConfig } from "github";
import { createDb, loadConfig as loadPersistenceConfig } from "persistence";

/** The built Hono app (inferred so `apps/web` needs no direct `hono` dep). */
type WebhookApp = ReturnType<typeof createApp>;

/**
 * Load `apps/web/.env` if present, then return the ambient env. Mirrors
 * `generate.server.ts`'s `loadEnv`: the file is optional (vars may already be
 * set in the environment), so a missing `.env` is not an error.
 */
function readEnv(): NodeJS.ProcessEnv {
  try {
    process.loadEnvFile();
  } catch {
    // No .env file — the required vars may still be set in the ambient env.
  }
  return process.env;
}

/**
 * Build the webhook app ONCE: read env, parse both configs (a misconfigured
 * server must fail LOUDLY — a bad env throws here rather than serving a broken
 * webhook), open one pooled db handle, install the `graphile_worker` schema so
 * the enqueue side works, then compose the Hono app over the injected deps.
 */
async function buildWebhookApp(): Promise<WebhookApp> {
  const env = readEnv();

  const githubConfig = loadGitHubConfig(env);
  if (!githubConfig.ok) {
    throw new Error(
      `webhook composition: invalid GitHub configuration — ${githubConfig.error.issues.join("; ")}`,
    );
  }

  const persistenceConfig = loadPersistenceConfig(env);
  if (!persistenceConfig.ok) {
    throw new Error(
      `webhook composition: invalid persistence configuration — ${persistenceConfig.error.issues.join("; ")}`,
    );
  }

  const { databaseUrl } = persistenceConfig.value;
  const handle = createDb(databaseUrl);
  // Enqueue-side schema install (idempotent). The worker that drains the jobs
  // is BRIEF-3; here we only guarantee `graphile_worker.add_job` exists.
  await migrateQueue(databaseUrl);

  return createApp({
    handle,
    webhookSecret: githubConfig.value.webhookSecret,
  });
}

/**
 * Cooldown after a build failure before another `buildWebhookApp()` is
 * attempted. Without it, a persistent I/O failure (Postgres down, bad
 * credentials, migration permission error) would re-run `createDb` +
 * `runMigrations` on EVERY inbound request — and GitHub redelivers failed
 * webhooks aggressively — turning one root cause into a connection/migration
 * storm against an already-struggling database (thundering herd). During the
 * window, requests fail fast with NO I/O; after it, exactly one request retries.
 */
const FAILURE_COOLDOWN_MS = 5000;

let appPromise: Promise<WebhookApp> | undefined;
let lastFailureAt: number | undefined;

/**
 * Lazily-initialized singleton accessor for the webhook Hono app. The first
 * request builds it (one db handle, one migration); later requests reuse the
 * memoized promise. A build FAILURE is negative-cached for `FAILURE_COOLDOWN_MS`
 * (fail fast, no DB touch) so a transient fault self-heals on the next attempt
 * after the window without hammering the database in between.
 */
export function getWebhookApp(): Promise<WebhookApp> {
  if (appPromise) {
    return appPromise;
  }
  if (
    lastFailureAt !== undefined &&
    Date.now() - lastFailureAt < FAILURE_COOLDOWN_MS
  ) {
    // Within the cooldown: fail fast without reopening a pool / re-migrating.
    return Promise.reject(
      new Error("webhook composition unavailable; retry shortly"),
    );
  }
  appPromise = buildWebhookApp().then(
    (app) => {
      lastFailureAt = undefined;
      return app;
    },
    (error: unknown) => {
      appPromise = undefined;
      lastFailureAt = Date.now();
      throw error;
    },
  );
  return appPromise;
}
