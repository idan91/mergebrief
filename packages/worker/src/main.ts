// The worker startup wiring (`pnpm start` / the compose `worker` service).
// This is the ONE place env is read and real dependencies are wired — the
// library modules stay env-INJECTED. A misconfigured worker must fail LOUDLY
// at boot, never limp into draining jobs it cannot complete.
import { createGenerator } from "generators";
import { createAppClient, loadConfig as loadGitHubConfig } from "github";
import { Logger as GraphileLogger } from "graphile-worker";
import { createGraphileLogFactory, createLogger } from "logging";
import { closeDb, createDb } from "persistence";
import { loadConfig } from "./config";
import { appGitHubPort } from "./task/github-port";
import { createGenerateTask } from "./task/generate";
import {
  createSweepAuditTask,
  SWEEP_AUDIT_CRONTAB,
  SWEEP_AUDIT_TASK,
} from "./task/sweep-audit";
import { startWorker } from "./runner";

/** Where failed-generation raw outputs are dumped for debugging (ephemeral). */
const FAILURE_DUMP_DIR = "out";

/** Load `packages/worker/.env` if present, then return the ambient env. */
function readEnv(): NodeJS.ProcessEnv {
  try {
    process.loadEnvFile();
  } catch {
    // No .env file — the required vars may still be set in the ambient env.
  }
  return process.env;
}

// The one process logger: everything here — composition, task, graphile
// lifecycle — logs through it. Its own construction can fail on config (bad
// LOG_LEVEL); that too must stay down, and with the boundary broken, bare
// console is the only channel left.
const env = readEnv();
const logger = (() => {
  try {
    return createLogger({ env });
  } catch (error) {
    // eslint-disable-next-line no-console -- the logging boundary itself failed to construct; bare console is the only channel left
    console.error("worker composition: invalid logging configuration —", error);
    process.exit(0);
  }
})();

/**
 * Config errors exit 0: a restart can never fix one, so under compose's
 * `restart: on-failure` a zero exit stays down with the reason as the log's
 * last line. Transient faults keep the throw → exit(1) restart self-heal.
 */
function exitOnConfigError(message: string): never {
  logger.error(message);
  process.exit(0);
}

async function main(): Promise<void> {
  // The DATABASE_URL_FILE shadow warning must reach the operator.
  const config = loadConfig(env, {
    onWarning: (message) => logger.warn(message),
  });
  if (!config.ok) {
    exitOnConfigError(
      `worker composition: invalid configuration — ${config.error.issues.join("; ")}`,
    );
  }
  // The worker authenticates to GitHub as the App (installation tokens) to
  // fetch PR data — same credential set the web tier already requires.
  const githubConfig = loadGitHubConfig(env);
  if (!githubConfig.ok) {
    exitOnConfigError(
      `worker composition: invalid GitHub configuration — ${githubConfig.error.issues.join("; ")}`,
    );
  }

  // The instance config (or zero-config default) selects the adapter; keys
  // resolve by env-var NAME and adapters run their startup checks here — a
  // misconfigured instance refuses boot before taking jobs.
  const generator = await createGenerator(config.value.generator, {
    env,
    failureDir: FAILURE_DUMP_DIR,
    // warn, not info: everything the registry surfaces here is
    // degraded/suspicious and should be alertable.
    log: (message) => logger.warn(message),
  });
  if (!generator.ok) {
    const message = `worker composition: invalid generator configuration — ${generator.error.issues.join("; ")}`;
    // Transient construction failures (a boot preflight hitting network/5xx)
    // keep the throw → exit(1) → restart self-heal; only deterministic
    // config errors stay down.
    if (generator.error.transient) {
      throw new Error(message);
    }
    exitOnConfigError(message);
  }

  // Pool error observer: a DB restart surfaces as warn lines, not an
  // unhandled-'error' process crash.
  const handle = createDb(config.value.databaseUrl, {
    onError: (error) =>
      logger.warn("postgres pool error (idle client)", { err: error }),
  });
  const configuredEffort = config.value.generator.effort;
  const configuredFullRegeneration =
    config.value.generator["full-regeneration"];
  const generate = createGenerateTask({
    handle,
    generator: generator.value,
    github: appGitHubPort(createAppClient(githubConfig.value)),
    publicBaseUrl: config.value.publicBaseUrl,
    // Absent → brief-core's medium default.
    ...(configuredEffort === undefined ? {} : { effort: configuredEffort }),
    // Absent → never.
    ...(configuredFullRegeneration === undefined
      ? {}
      : { fullRegeneration: configuredFullRegeneration }),
    // No `spend` block → uncapped.
    spend: config.value.spend,
    log: logger,
  });

  const sweepAudit = createSweepAuditTask({
    handle,
    retentionDays: config.value.auditRetentionDays,
    log: logger,
  });

  const runner = await startWorker({
    databaseUrl: config.value.databaseUrl,
    // MERGEBRIEF_AUTO_MIGRATE=false → read-only schema check at boot.
    autoMigrate: config.value.autoMigrate,
    // helpers.abortSignal is graphile's graceful-shutdown signal: SIGTERM
    // aborts an in-flight stream (job back to queue) instead of riding out the
    // kill grace into a stuck job lock. helpers.job carries the attempt counts
    // the failure events read.
    taskList: {
      generate: (payload, helpers) => generate(payload, helpers),
      // The one scheduled job. Instance-wide, not tenant-scoped: retention is
      // an operator env setting, so there is no ctx to bind it to.
      [SWEEP_AUDIT_TASK]: () => sweepAudit(),
    },
    // Unset retention → the job still runs and deletes nothing.
    crontab: SWEEP_AUDIT_CRONTAB,
    // graphile's lifecycle logs flow through the logging boundary.
    logger: new GraphileLogger(createGraphileLogFactory(logger)),
  });
  const retention = config.value.auditRetentionDays;
  logger.info(
    `worker: listening for generate jobs; audit retention ${retention === null ? "unset (rows kept forever)" : `${retention}d`}`,
  );

  try {
    // Runs until a signal stops it; graphile owns the graceful part (stop
    // claiming, abort in-flight via helpers.abortSignal, release its pool).
    await runner.promise;
  } finally {
    await closeDb(handle);
  }
  logger.info("worker: stopped");
}

main().catch((error: unknown) => {
  // Boot failures are the documented exemption to the message-only rule:
  // nothing provider-shaped reaches here, and the boundary's serializer scrubs
  // the URL-shaped secrets a migrate failure quotes back.
  logger.error("worker: boot failed", { err: error });
  process.exit(1);
});
