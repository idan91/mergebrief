// The API startup wiring (`pnpm start` and the compose `api` service). This is
// the ONE place env is read and real dependencies are wired; every module
// below stays env-INJECTED. A misconfigured API must fail LOUDLY at boot
// rather than serve a half-wired surface.
import { serve, type ServerType } from "@hono/node-server";
import { RUNTIME_MARKER_VAR } from "generators/instance-policy";
import { createAppClient, createUserOctokit } from "github";
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
import { ExitCodes } from "./boot/types";
import { SESSION_KEY_REF } from "./config";
import { handleHealthRequest } from "./health";
import { migrateQueue } from "./queue";
import { appInstallationPort } from "./routes/github-port";
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
  const sessionKey = await keyProvider.resolveKey(SESSION_KEY_REF);
  if (!sessionKey.ok) {
    exitOnConfigError(
      logger,
      `api composition: ${SESSION_KEY_REF} is missing or invalid: ${sessionKey.error.code}`,
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
  });

  const updateCheck = createUpdateCheck({
    serverVersion: boot.api.serverVersion,
    enabled: boot.api.updateCheck,
    url: boot.api.updateCheckUrl,
    fetch,
    log: logger,
  });

  const app = createApp({
    handle,
    webhookSecret: boot.github.webhookSecret,
    logger,
    draftPolicy: boot.draftPolicy,
    updateCheck,
    audit: {
      privateWrites: boot.persistence.auditPrivateWrites,
      callerIp: boot.persistence.auditCallerIp,
    },
    serverVersion: boot.api.serverVersion,
    github: appInstallationPort(createAppClient(boot.github)),
    operatorToken: boot.github.operatorToken,
    githubAppSlug: boot.github.appSlug,
    attachmentQuota: boot.api.attachmentQuota,
    auth: {
      oauthClientId: boot.github.oauthClientId,
      oauthClientSecret: boot.github.oauthClientSecret,
      keyProvider,
      sessionKeyRef: SESSION_KEY_REF,
      publicBaseUrl: boot.api.publicBaseUrl,
      createUserOctokit,
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

/** SIGTERM and SIGINT stop accepting, then release the pool before exiting. */
function installShutdown(
  server: ServerType,
  handle: AppDatabase,
  updateCheck: UpdateCheck,
): void {
  let closing = false;
  const shutdown = (signal: string): void => {
    if (closing) return;
    closing = true;
    logger.info("api shutting down", { signal });
    updateCheck.stop();
    server.close(() => {
      void closeDb(handle).then(
        () => process.exit(ExitCodes.SUCCESS),
        (error: unknown) => {
          logger.warn("api shutdown: closing the pool failed", { err: error });
          process.exit(ExitCodes.SUCCESS);
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
  process.exit(ExitCodes.FAILURE);
});
