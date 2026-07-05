// The webhook composition root (BRIEF-2 stage 5). This is the ONE place the
// injected libraries are wired to real env + a real database: `apps/web` reads
// `process.env` here (mirroring `generate.server.ts`'s `loadEnv`), the `api`,
// `github`, and `persistence` packages stay env-INJECTED (they never read env
// themselves). The custom server entry (`src/server.ts`) delegates `/api/*` +
// `/auth/*` to the Hono app this module builds.
import "@tanstack/react-start/server-only";

import { createApp, migrateQueue } from "api";
import { loadConfig as loadGitHubConfig } from "github";
import {
  createDb,
  envKeyProvider,
  loadConfig as loadPersistenceConfig,
} from "persistence";

/** The env var name the reviewer session tokens seal under (ADR 0018 D11). */
const SESSION_KEY_REF = "SESSION_KEY_V1";

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

  // The public origin the OAuth callback URL is built from (must match the
  // App's registered callback). Required for the reviewer-auth routes (PR C);
  // fail loudly if absent, same posture as the config parses above.
  const publicBaseUrl = env["PUBLIC_BASE_URL"];
  if (publicBaseUrl === undefined || publicBaseUrl.length === 0) {
    throw new Error(
      "webhook composition: PUBLIC_BASE_URL is required for reviewer auth",
    );
  }

  // Eagerly validate the session-sealing key, same fail-loudly posture as the
  // config parses: a missing/malformed SESSION_KEY_V1 must fail HERE, not on
  // the first token seal — and, worse, a key changed post-deploy would make
  // every stored ciphertext undecryptable, which the authz gate treats as a
  // burned session (mass logout). The resolved bytes are discarded; the
  // provider re-resolves per seal (the KMS-seam contract).
  const keyProvider = envKeyProvider(env);
  const sessionKey = await keyProvider.resolveKey(SESSION_KEY_REF);
  if (!sessionKey.ok) {
    throw new Error(
      `webhook composition: ${SESSION_KEY_REF} is missing or invalid — ${sessionKey.error.code}`,
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
    // Reviewer-auth bundle (PR C): OAuth creds from the GitHub config, the
    // env-backed key provider for token sealing (validated eagerly above), and
    // the cookie/redirect policy.
    auth: {
      oauthClientId: githubConfig.value.oauthClientId,
      oauthClientSecret: githubConfig.value.oauthClientSecret,
      keyProvider,
      sessionKeyRef: SESSION_KEY_REF,
      publicBaseUrl,
      cookieSecure: true,
    },
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
