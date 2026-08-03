// The webhook composition root (BRIEF-2 stage 5). This is the ONE place the
// injected libraries are wired to real env + a real database: `apps/web` reads
// `process.env` here (mirroring `generate.server.ts`'s `loadEnv`), the `api`,
// `github`, and `persistence` packages stay env-INJECTED (they never read env
// themselves). The custom server entry (`src/server.ts`) delegates `/api/*` — the
// app's ONE registered namespace (BRIEF-18) — to the Hono app this module builds.
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

/** The env var name the reviewer session tokens seal under (ADR 0018 D11). */
const SESSION_KEY_REF = "SESSION_KEY_V1";

/** The built Hono app (inferred so `apps/web` needs no direct `hono` dep). */
type WebhookApp = ReturnType<typeof createApp>;

/** The app plus the handle it was composed over (the /readyz probe target). */
interface WebhookComposition {
  readonly app: WebhookApp;
  readonly handle: AppDatabase;
}

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
async function buildWebhookApp(): Promise<WebhookComposition> {
  const env = readEnv();
  const logger = getServerLogger();

  const githubConfig = loadGitHubConfig(env);
  if (!githubConfig.ok) {
    throw new Error(
      `webhook composition: invalid GitHub configuration — ${githubConfig.error.issues.join("; ")}`,
    );
  }

  // The DATABASE_URL_FILE shadow warning (BRIEF-131) must reach the operator.
  const persistenceConfig = loadPersistenceConfig(env, {
    onWarning: (message) => logger.warn(message),
  });
  if (!persistenceConfig.ok) {
    throw new Error(
      `webhook composition: invalid persistence configuration — ${persistenceConfig.error.issues.join("; ")}`,
    );
  }

  // Instance draft policy (BRIEF-64): the NARROW loader — only the `drafts`
  // block is read here; the generator block stays the worker's concern (this
  // process needs no adapter validation and no provider keys). Same
  // fail-loudly posture as the config parses above; unset MERGEBRIEF_CONFIG
  // yields the zero-config default (drafts generate, no damping).
  const instancePolicy = loadInstancePolicy(env);
  if (!instancePolicy.ok) {
    throw new Error(
      `webhook composition: invalid instance draft policy — ${instancePolicy.error.issues.join("; ")}`,
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
  // Boot migrations, both idempotent (BRIEF-3: every composition root may run
  // them; whoever boots first applies, the rest no-op): the app schema the
  // webhook writes to, then the graphile_worker schema `add_job` needs.
  // Under MERGEBRIEF_AUTO_MIGRATE=false (BRIEF-131) the app-schema step is a
  // read-only check that refuses composition when the database is behind.
  const ensured = await ensureAppSchema(databaseUrl, {
    autoMigrate: persistenceConfig.value.autoMigrate,
  });
  if (!ensured.ok) {
    throw new Error(`webhook composition: ${ensured.error.message}`);
  }
  await migrateQueue(databaseUrl);
  // The pool error observer keeps a DB restart from crashing the process
  // (liveness contract, ADR 0034 #7) — the blip surfaces as warn lines and
  // a 503 /readyz, not a dead /healthz.
  const handle = createDb(databaseUrl, {
    onError: (error) =>
      logger.warn("postgres pool error (idle client)", { err: error }),
  });

  const app = createApp({
    handle,
    webhookSecret: githubConfig.value.webhookSecret,
    // The process logger (ADR 0034): one instance for the whole web tier;
    // the api package derives per-request children from it.
    logger,
    // Draft-PR generation policy (BRIEF-64) — enforced at the enqueue path.
    draftPolicy: instancePolicy.value.draftPolicy,
    // Skew visibility (ADR 0029 #8): surfaced by GET /api/version and the
    // CLI's `auth status`; the api changelog is keyed to it.
    serverVersion: process.env["SERVER_VERSION"] ?? "dev",
    // Installation-token reads (conversation, collaborators) run as the App on the installation token (ADR 0027):
    // one rate budget and one cache entry per PR, gate-authorized per viewer.
    github: appInstallationPort(createAppClient(githubConfig.value)),
    // Generate-from-URL engine (BRIEF-97): the octokit-PrSource pipeline over
    // the VIEWER's token. Composition-root wiring — the one place feature
    // server code legitimately meets the global layer.
    urlBriefEngine: createUrlBriefEngine(),
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
  return { app, handle };
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

let compositionPromise: Promise<WebhookComposition> | undefined;
let lastFailureAt: number | undefined;

/**
 * Lazily-initialized singleton accessor for the webhook composition. The
 * first request builds it (one db handle, one migration); later requests
 * reuse the memoized promise. A build FAILURE is negative-cached for
 * `FAILURE_COOLDOWN_MS` (fail fast, no DB touch) so a transient fault
 * self-heals on the next attempt after the window without hammering the
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
 * The /readyz probe (ADR 0034 #7): the composition resolves AND one
 * `SELECT 1` round-trips through its handle. `false` covers both a failed
 * composition (misconfig, cooldown window) and an unreachable database —
 * the caller answers 503 either way, leaking neither distinction.
 */
export async function checkReadiness(): Promise<boolean> {
  try {
    const { handle } = await getComposition();
    return await pingDb(handle);
  } catch {
    return false;
  }
}
