// The API startup wiring (`pnpm start` and the compose `api` service). This is
// the ONE place env is read and real dependencies are wired; every module
// below stays env-INJECTED. A misconfigured API must fail LOUDLY at boot
// rather than serve a half-wired surface.
import { serve, type ServerType } from "@hono/node-server";
import { RUNTIME_MARKER_VAR } from "generators/instance-policy";
import {
  bindInstallationGitHub,
  bindOperatorGitHub,
  bindReviewerGitHub,
  createAppClient,
  resolveOperatorTokenOwner,
} from "github";
import { stopTracing } from "logging/tracing";
import {
  closeDb,
  createDb,
  createEnvKeyProvider,
  ensureAppSchema,
  pingDb,
  resolveMigrateCommand,
  type AppDatabase,
} from "persistence";
import { createApp } from "./app";
import { createBootLogger, exitOnConfigError, loadBootConfig } from "./boot";
import { resolveLocalBriefsDir } from "./boot/local-briefs-dir";
import { ExitCodes } from "./boot/types";
import { handleHealthRequest } from "./health";
import { migrateQueue } from "./queue";
import { createUpdateCheck, type UpdateCheck } from "./update-check";

/** Load the app's `.env` if present, then return the ambient env. */
function readEnv(): NodeJS.ProcessEnv {
  try {
    process.loadEnvFile();
  } catch {
    // No .env file; the required vars may still be set in the ambient env.
  }
  return process.env;
}

const env = readEnv();
const logger = createBootLogger(env);

async function main(): Promise<void> {
  const boot = loadBootConfig(env, logger);

  // Eager: a key changed post-deploy makes every stored ciphertext
  // undecryptable, which the gate reads as a mass logout.
  const keyProvider = createEnvKeyProvider(env);
  const { sessionKeyRef } = boot.api;
  const sessionKey = await keyProvider.resolveKey(sessionKeyRef);
  if (!sessionKey.ok) {
    exitOnConfigError(
      logger,
      `api composition: ${sessionKeyRef} is missing or invalid: ${sessionKey.error.code}`,
    );
  }

  const { databaseUrl } = boot.persistence;
  // Idempotent: whoever boots first applies, the rest no-op. Under
  // MERGEBRIEF_AUTO_MIGRATE=false this is a read-only check instead.
  const ensured = await ensureAppSchema(databaseUrl, {
    autoMigrate: boot.persistence.autoMigrate,
    runningVersion: boot.api.serverVersion,
    log: logger,
    migrateCommand: resolveMigrateCommand(env[RUNTIME_MARKER_VAR]),
  });
  if (!ensured.ok) {
    // FAILURE, not the config-error SUCCESS: pending migrations are fixed by
    // a migrate run, after which a restart succeeds.
    logger.error(`api composition: ${ensured.error.message}`);
    process.exit(ExitCodes.FAILURE);
  }
  await migrateQueue(databaseUrl);
  const handle: AppDatabase = createDb(databaseUrl, {
    onError: (error) =>
      logger.warn("postgres pool error (idle client)", { err: error }),
    maxConnections: boot.persistence.poolMax,
  });

  const updateCheck = createUpdateCheck({
    serverVersion: boot.api.serverVersion,
    enabled: boot.api.updateCheck,
    url: boot.api.updateCheckUrl,
    fetch,
    log: logger,
  });

  const configuredOutDir = boot.api.localBriefsDir;
  const localBriefsDir =
    configuredOutDir === undefined
      ? undefined
      : resolveLocalBriefsDir(configuredOutDir, process.cwd());

  // One App client, so every installation binding shares its tokens.
  const githubApp = createAppClient(boot.github);
  // Awaited once before serving; a lookup still pending serves nobody.
  const configuredOperatorToken = boot.github.operatorToken;
  const operatorToken =
    configuredOperatorToken === undefined
      ? undefined
      : await resolveOperatorTokenOwner(configuredOperatorToken, {
          log: logger,
        });
  const app = createApp({
    handle,
    webhookSecret: boot.github.webhookSecret,
    logger,
    draftPolicy: boot.draftPolicy,
    spendPolicy: boot.spendPolicy,
    operatorIds: boot.operatorIds,
    updateCheck,
    audit: {
      privateWrites: boot.persistence.auditPrivateWrites,
    },
    serverVersion: boot.api.serverVersion,
    bindInstallationGitHub: (installationId) =>
      bindInstallationGitHub(githubApp, installationId),
    operatorToken,
    githubAppSlug: boot.github.appSlug,
    attachmentQuota: boot.api.attachmentQuota,
    localBriefsDir,
    auth: {
      oauthClientId: boot.github.oauthClientId,
      oauthClientSecret: boot.github.oauthClientSecret,
      keyProvider,
      sessionKeyRef,
      publicBaseUrl: boot.api.publicBaseUrl,
      bindReviewerGitHub,
      bindOperatorGitHub,
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
      updateCheck.start();
    },
  );

  installShutdown(server, handle, updateCheck);
}

/** SIGTERM and SIGINT stop accepting, release the pool, then flush the last
 * spans before exiting. */
function installShutdown(
  server: ServerType,
  handle: AppDatabase,
  updateCheck: UpdateCheck,
): void {
  let closing = false;
  const shutdown = (signal: string): void => {
    if (closing) {
      return;
    }
    closing = true;
    logger.info("api shutting down", { signal });
    updateCheck.stop();
    server.close(() => {
      const poolClosed = closeDb(handle).catch((error: unknown) => {
        logger.warn("api shutdown: closing the pool failed", { err: error });
      });
      const tracingStopped = poolClosed.then(() => stopTracing(logger));
      void tracingStopped.finally(() => process.exit(ExitCodes.SUCCESS));
    });
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((error: unknown) => {
  // Transient faults keep the nonzero exit so a restart can self-heal.
  logger.error("api composition failed", { err: error });
  process.exit(ExitCodes.FAILURE);
});
