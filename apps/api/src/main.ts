// The API startup wiring (`pnpm start` and the compose `api` service). This is
// the ONE place env is read and real dependencies are wired; every module
// below stays env-INJECTED. A misconfigured API must fail LOUDLY at boot
// rather than serve a half-wired surface.
import { serve, type ServerType } from "@hono/node-server";
import { loadInstancePolicy } from "generators";
import {
  createAppClient,
  loadConfig as loadGitHubConfig,
  type GitHubConfig,
} from "github";
import { createLogger, type Logger } from "logging";
import {
  closeDb,
  createDb,
  createEnvKeyProvider,
  ensureAppSchema,
  loadConfig as loadPersistenceConfig,
  pingDb,
  type AppDatabase,
  type PersistenceConfig,
} from "persistence";
import type { DraftPolicy } from "types/drafts";
import { createApp } from "./app";
import { loadConfig, SESSION_KEY_REF, type ApiConfig } from "./config";
import { handleHealthRequest } from "./health";
import { migrateQueue } from "./queue";
import { appInstallationPort } from "./routes/github-port";

/** Load `apps/api/.env` if present, then return the ambient env. */
function readEnv(): NodeJS.ProcessEnv {
  try {
    process.loadEnvFile();
  } catch {
    // No .env file; the required vars may still be set in the ambient env.
  }
  return process.env;
}

const env = readEnv();
const logger = ((): Logger => {
  try {
    return createLogger({ env });
  } catch (error) {
    // oxlint-disable-next-line no-console -- the logging boundary itself failed to construct; bare console is the only channel left
    console.error("api composition: invalid logging configuration", error);
    process.exit(0);
  }
})();

/**
 * Config errors exit 0: a restart can never fix one, so under a container's
 * `restart: on-failure` a zero exit stays down with the reason as the log's
 * last line. Transient faults keep the throw to exit(1) restart self-heal.
 */
function exitOnConfigError(message: string): never {
  logger.error(message);
  process.exit(0);
}

interface BootConfig {
  readonly api: ApiConfig;
  readonly github: GitHubConfig;
  readonly persistence: PersistenceConfig;
  readonly draftPolicy: DraftPolicy;
}

/** Every config block, or the process exits before anything is constructed. */
function loadBootConfig(): BootConfig {
  const config = loadConfig(env);
  if (!config.ok) {
    exitOnConfigError(
      `api composition: invalid configuration: ${config.error.issues.join("; ")}`,
    );
  }
  const githubConfig = loadGitHubConfig(env);
  if (!githubConfig.ok) {
    exitOnConfigError(
      `api composition: invalid GitHub configuration: ${githubConfig.error.issues.join("; ")}`,
    );
  }
  const persistenceConfig = loadPersistenceConfig(env, {
    onWarning: (message) => logger.warn(message),
  });
  if (!persistenceConfig.ok) {
    exitOnConfigError(
      `api composition: invalid persistence configuration: ${persistenceConfig.error.issues.join("; ")}`,
    );
  }
  // Only the `drafts` block: the generator block is the worker's concern, so
  // this process needs no adapter validation and no provider keys.
  const instancePolicy = loadInstancePolicy(env);
  if (!instancePolicy.ok) {
    exitOnConfigError(
      `api composition: invalid instance draft policy: ${instancePolicy.error.issues.join("; ")}`,
    );
  }
  return {
    api: config.value,
    github: githubConfig.value,
    persistence: persistenceConfig.value,
    draftPolicy: instancePolicy.value.draftPolicy,
  };
}

async function main(): Promise<void> {
  const boot = loadBootConfig();

  // Eager: a key changed post-deploy makes every stored ciphertext
  // undecryptable, which the gate reads as a mass logout.
  const keyProvider = createEnvKeyProvider(env);
  const sessionKey = await keyProvider.resolveKey(SESSION_KEY_REF);
  if (!sessionKey.ok) {
    exitOnConfigError(
      `api composition: ${SESSION_KEY_REF} is missing or invalid: ${sessionKey.error.code}`,
    );
  }

  const { databaseUrl } = boot.persistence;
  // Idempotent: whoever boots first applies, the rest no-op. Under
  // MERGEBRIEF_AUTO_MIGRATE=false this is a read-only check instead.
  const ensured = await ensureAppSchema(databaseUrl, {
    autoMigrate: boot.persistence.autoMigrate,
  });
  if (!ensured.ok) {
    exitOnConfigError(`api composition: ${ensured.error.message}`);
  }
  await migrateQueue(databaseUrl);
  const handle: AppDatabase = createDb(databaseUrl, {
    onError: (error) =>
      logger.warn("postgres pool error (idle client)", { err: error }),
  });

  const app = createApp({
    handle,
    webhookSecret: boot.github.webhookSecret,
    logger,
    draftPolicy: boot.draftPolicy,
    audit: {
      privateWrites: boot.persistence.auditPrivateWrites,
      callerIp: boot.persistence.auditCallerIp,
    },
    serverVersion: boot.api.serverVersion,
    github: appInstallationPort(createAppClient(boot.github)),
    urlBoxFallbackToken: boot.api.urlBoxFallbackToken,
    githubAppSlug: boot.github.appSlug,
    auth: {
      oauthClientId: boot.github.oauthClientId,
      oauthClientSecret: boot.github.oauthClientSecret,
      keyProvider,
      sessionKeyRef: SESSION_KEY_REF,
      publicBaseUrl: boot.api.publicBaseUrl,
      cookieSecure: true,
    },
  });

  const server = serve(
    {
      fetch: async (request: Request, serverEnv: unknown) => {
        const { pathname } = new URL(request.url);
        const health = await handleHealthRequest(pathname, {
          checkReadiness: () => pingDb(handle),
        });
        return health ?? app.fetch(request, serverEnv);
      },
      hostname: boot.api.host,
      port: boot.api.port,
    },
    (info) => {
      logger.info("api listening", { port: info.port });
    },
  );

  installShutdown(server, handle);
}

/** SIGTERM and SIGINT stop accepting, then release the pool before exiting. */
function installShutdown(server: ServerType, handle: AppDatabase): void {
  let closing = false;
  const shutdown = (signal: string): void => {
    if (closing) return;
    closing = true;
    logger.info("api shutting down", { signal });
    server.close(() => {
      void closeDb(handle).then(
        () => process.exit(0),
        (error: unknown) => {
          logger.warn("api shutdown: closing the pool failed", { err: error });
          process.exit(0);
        },
      );
    });
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((error: unknown) => {
  // Transient faults keep the nonzero exit so a restart can self-heal.
  logger.error("api composition failed", { err: error });
  process.exit(1);
});
