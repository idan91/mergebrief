// The webhook startup wiring: the ONE place the injected libraries meet real
// env and a real database. `apps/web` reads `process.env` here; the `api`,
// `github`, and `persistence` packages stay env-INJECTED. The server entry
// delegates `/api/*` — the app's ONE registered namespace — to the Hono app
// this module builds.
import "@tanstack/react-start/server-only";

import { appInstallationPort, createApp, migrateQueue } from "api";
import { loadInstancePolicy } from "generators";
import { createAppClient, loadConfig as loadGitHubConfig } from "github";
import {
  createDb,
  ensureAppSchema,
  envKeyProvider,
  loadConfig as loadPersistenceConfig,
  pingDb,
  type AppDatabase,
} from "persistence";
import { createUrlBriefEngine } from "../features/brief/server/urlBriefEngine.server";
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

/**
 * Load `apps/web/.env` if present, then return the ambient env. The file is
 * optional — vars may already be set in the environment.
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
async function buildWebhookApp(): Promise<WebhookComposition> {
  const env = readEnv();
  const logger = getServerLogger();

  const githubConfig = loadGitHubConfig(env);
  if (!githubConfig.ok) {
    throw new Error(
      `webhook composition: invalid GitHub configuration — ${githubConfig.error.issues.join("; ")}`,
    );
  }

  // The DATABASE_URL_FILE shadow warning must reach the operator.
  const persistenceConfig = loadPersistenceConfig(env, {
    onWarning: (message) => logger.warn(message),
  });
  if (!persistenceConfig.ok) {
    throw new Error(
      `webhook composition: invalid persistence configuration — ${persistenceConfig.error.issues.join("; ")}`,
    );
  }

  // The NARROW policy loader: only the `drafts` block is read here — the
  // generator block stays the worker's concern, so this process needs no
  // adapter validation and no provider keys. Unset MERGEBRIEF_CONFIG yields
  // the zero-config default.
  const instancePolicy = loadInstancePolicy(env);
  if (!instancePolicy.ok) {
    throw new Error(
      `webhook composition: invalid instance draft policy — ${instancePolicy.error.issues.join("; ")}`,
    );
  }

  // The public origin the OAuth callback URL is built from — must match the
  // App's registered callback, so fail loudly if absent.
  const publicBaseUrl = env["PUBLIC_BASE_URL"];
  if (publicBaseUrl === undefined || publicBaseUrl.length === 0) {
    throw new Error(
      "webhook composition: PUBLIC_BASE_URL is required for reviewer auth",
    );
  }

  // Validate the session-sealing key eagerly: a missing or malformed key must
  // fail HERE, not on the first token seal, and a key changed post-deploy makes
  // every stored ciphertext undecryptable (the gate reads that as a burned
  // session — mass logout). The resolved bytes are discarded; the provider
  // re-resolves per seal.
  const keyProvider = envKeyProvider(env);
  const sessionKey = await keyProvider.resolveKey(SESSION_KEY_REF);
  if (!sessionKey.ok) {
    throw new Error(
      `webhook composition: ${SESSION_KEY_REF} is missing or invalid — ${sessionKey.error.code}`,
    );
  }

  const { databaseUrl } = persistenceConfig.value;
  // Boot migrations, both idempotent — every startup wiring may run them;
  // whoever boots first applies, the rest no-op. Under
  // MERGEBRIEF_AUTO_MIGRATE=false the app-schema step is a read-only check
  // that refuses composition when the database is behind.
  const ensured = await ensureAppSchema(databaseUrl, {
    autoMigrate: persistenceConfig.value.autoMigrate,
  });
  if (!ensured.ok) {
    throw new Error(`webhook composition: ${ensured.error.message}`);
  }
  await migrateQueue(databaseUrl);
  // The pool error observer keeps a DB restart from crashing the process — the
  // blip surfaces as warn lines and a 503 /readyz, not a dead /healthz.
  const handle = createDb(databaseUrl, {
    onError: (error) =>
      logger.warn("postgres pool error (idle client)", { err: error }),
  });

  const app = createApp({
    handle,
    webhookSecret: githubConfig.value.webhookSecret,
    // One process logger for the whole web tier; the api package derives
    // per-request children from it.
    logger,
    // Enforced at the enqueue path.
    draftPolicy: instancePolicy.value.draftPolicy,
    // Skew visibility: surfaced by GET /api/version and the CLI's `auth
    // status`; the api changelog is keyed to it.
    serverVersion: process.env["SERVER_VERSION"] ?? "dev",
    // Conversation and collaborator reads run as the App on the installation
    // token: one rate budget and one cache entry per PR, gate-authorized per
    // viewer.
    github: appInstallationPort(createAppClient(githubConfig.value)),
    // The octokit-PrSource pipeline over the VIEWER's token. Composition-root
    // wiring — the one place feature server code legitimately meets the global
    // layer.
    urlBriefEngine: createUrlBriefEngine(),
    // OAuth creds from the GitHub config, the env-backed key provider for
    // token sealing (validated eagerly above), and the cookie/redirect policy.
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
 * migrations on EVERY inbound request — and GitHub redelivers failed webhooks
 * aggressively — storming an already-struggling database.
 */
const FAILURE_COOLDOWN_MS = 5000;

let compositionPromise: Promise<WebhookComposition> | undefined;
let lastFailureAt: number | undefined;

/**
 * Lazily-initialized singleton accessor for the webhook composition. The first
 * request builds it (one db handle, one migration); later requests reuse the
 * memoized promise. A build FAILURE is negative-cached for
 * `FAILURE_COOLDOWN_MS` so a transient fault self-heals without hammering the
 * database in between.
 */
function getComposition(): Promise<WebhookComposition> {
  if (compositionPromise) {
    return compositionPromise;
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
 * unreachable database — the caller answers 503 either way, leaking neither
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
