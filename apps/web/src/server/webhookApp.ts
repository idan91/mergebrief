// The web tier's composition root: the one place injected libraries meet real
// env and a real database. api, github and persistence stay env-injected.
import "@tanstack/react-start/server-only";

import { appInstallationPort, createApp, migrateQueue } from "api";
import { loadInstancePolicy } from "generators";
import { createAppClient, loadConfig as loadGitHubConfig } from "github";
import {
  createDb,
  ensureAppSchema,
  createEnvKeyProvider,
  loadConfig as loadPersistenceConfig,
  pingDb,
  type AppDatabase,
} from "persistence";
import { getServerEnv } from "./env";
import { getServerLogger } from "./logger";

/** The env var name the reviewer session tokens seal under. */
const SESSION_KEY_REF = "SESSION_KEY_V1";

/** The built Hono app (inferred so `apps/web` needs no direct `hono` dep). */
type WebhookApp = ReturnType<typeof createApp>;

/** The app plus the handle it was composed over (the /readyz probe target). */
interface WebhookComposition {
  readonly app: WebhookApp;
  readonly handle: AppDatabase;
}

/** A misconfigured server fails here, loudly, rather than serving a broken webhook. */
async function buildWebhookApp(): Promise<WebhookComposition> {
  const env = getServerEnv();
  const logger = getServerLogger();

  const githubConfig = loadGitHubConfig(env);
  if (!githubConfig.ok) {
    throw new Error(
      `webhook composition: invalid GitHub configuration — ${githubConfig.error.issues.join("; ")}`,
    );
  }

  const persistenceConfig = loadPersistenceConfig(env, {
    onWarning: (message) => logger.warn(message),
  });
  if (!persistenceConfig.ok) {
    throw new Error(
      `webhook composition: invalid persistence configuration — ${persistenceConfig.error.issues.join("; ")}`,
    );
  }

  // Only the `drafts` block: the generator block is the worker's concern, so
  // this process needs no adapter validation and no provider keys.
  const instancePolicy = loadInstancePolicy(env);
  if (!instancePolicy.ok) {
    throw new Error(
      `webhook composition: invalid instance draft policy — ${instancePolicy.error.issues.join("; ")}`,
    );
  }

  // The public origin the OAuth callback URL is built from, must match the
  // App's registered callback, so fail loudly if absent.
  const publicBaseUrl = env["PUBLIC_BASE_URL"];
  if (publicBaseUrl === undefined || publicBaseUrl.length === 0) {
    throw new Error(
      "webhook composition: PUBLIC_BASE_URL is required for reviewer auth",
    );
  }

  // Eager: a key changed post-deploy makes every stored ciphertext
  // undecryptable, which the gate reads as a mass logout.
  const keyProvider = createEnvKeyProvider(env);
  const sessionKey = await keyProvider.resolveKey(SESSION_KEY_REF);
  if (!sessionKey.ok) {
    throw new Error(
      `webhook composition: ${SESSION_KEY_REF} is missing or invalid — ${sessionKey.error.code}`,
    );
  }

  const { databaseUrl } = persistenceConfig.value;
  // Idempotent: whoever boots first applies, the rest no-op. Under
  // MERGEBRIEF_AUTO_MIGRATE=false this is a read-only check instead.
  const ensured = await ensureAppSchema(databaseUrl, {
    autoMigrate: persistenceConfig.value.autoMigrate,
  });
  if (!ensured.ok) {
    throw new Error(`webhook composition: ${ensured.error.message}`);
  }
  await migrateQueue(databaseUrl);
  const handle = createDb(databaseUrl, {
    onError: (error) =>
      logger.warn("postgres pool error (idle client)", { err: error }),
  });

  const app = createApp({
    handle,
    webhookSecret: githubConfig.value.webhookSecret,

    logger,
    draftPolicy: instancePolicy.value.draftPolicy,
    audit: {
      privateWrites: persistenceConfig.value.auditPrivateWrites,
      callerIp: persistenceConfig.value.auditCallerIp,
    },
    serverVersion: env["SERVER_VERSION"] ?? "dev",
    github: appInstallationPort(createAppClient(githubConfig.value)),
    urlBoxFallbackToken: env["MERGEBRIEF_URL_BOX_TOKEN"] || undefined,

    auth: {
      oauthClientId: githubConfig.value.oauthClientId,
      oauthClientSecret: githubConfig.value.oauthClientSecret,
      keyProvider,
      sessionKeyRef: SESSION_KEY_REF,
      publicBaseUrl,
      cookieSecure: true,
    },
  });
  return { app, handle };
}

/**
 * Cooldown after a build failure before another `buildWebhookApp()` is
 * attempted. Without it a persistent I/O failure would re-run `createDb` plus
 * migrations on EVERY inbound request, and GitHub redelivers failed webhooks
 * aggressively, storming an already-struggling database.
 */
const FAILURE_COOLDOWN_MS = 5000;

let compositionPromise: Promise<WebhookComposition> | undefined;
let lastFailureAt: number | undefined;

/** A build failure is negative-cached, so a transient fault self-heals. */
function getComposition(): Promise<WebhookComposition> {
  if (compositionPromise) {
    return compositionPromise;
  }
  if (
    lastFailureAt !== undefined &&
    Date.now() - lastFailureAt < FAILURE_COOLDOWN_MS
  ) {
    return Promise.reject(
      new Error("webhook composition unavailable; retry shortly"),
    );
  }
  compositionPromise = buildWebhookApp().then(
    (composition) => {
      lastFailureAt = undefined;
      return composition;
    },
    (error: unknown) => {
      compositionPromise = undefined;
      lastFailureAt = Date.now();
      throw error;
    },
  );
  return compositionPromise;
}

/** The Hono app for `/api/*` dispatch (the entry + SSR's in-process path). */
export function getWebhookApp(): Promise<WebhookApp> {
  return getComposition().then((composition) => composition.app);
}

/**
 * The /readyz probe: the composition resolves AND one `SELECT 1` round-trips
 * through its handle. `false` covers both a failed composition and an
 * unreachable database, the caller answers 503 either way, leaking neither
 * distinction.
 */
export async function checkReadiness(): Promise<boolean> {
  try {
    const { handle } = await getComposition();
    return await pingDb(handle);
  } catch {
    return false;
  }
}
