// The worker startup wiring (`pnpm start` / the compose `worker` service).
// This is the ONE place env is read and real dependencies are wired, the
// library modules stay env-INJECTED. A misconfigured worker must fail LOUDLY
// at boot, never limp into draining jobs it cannot complete.
import { createBuiltInContextProviders, JiraTransports } from "brief-core";
import {
  applyDefaultConfigPath,
  createGenerator,
  RUNTIME_MARKER_VAR,
} from "generators";
import {
  createAppClient,
  createOAuthApp,
  loadConfig as loadGitHubConfig,
  resolveOperatorTokenOwner,
  listHookDeliveries,
  redeliverHookDelivery,
} from "github";
import { Logger as GraphileLogger } from "graphile-worker";
import { createI18n } from "i18n";
import { createGraphileLogFactory, createLogger } from "logging";
import { stopTracing } from "logging/tracing";
import {
  closeDb,
  createDb,
  createEnvKeyProvider,
  resolveMigrateCommand,
} from "persistence";
import type { Mutable } from "types/utils";
import { loadConfig } from "./config";
import {
  createAppGitHubBinders,
  createGitHubPort,
  type UrlBoxAuthDeps,
} from "./task/github-port";
import {
  createGenerateTask,
  createRecoverGenerationTask,
  createSyncEntryTask,
  type GenerateTaskDeps,
} from "./task/generate";
import { RunPools } from "./task/generate/types";
import { createReconcileWebhookDeliveriesTask } from "./task/reconcile-webhook-deliveries";
import { RECONCILE_WEBHOOK_DELIVERIES_CRONTAB } from "./task/reconcile-webhook-deliveries/consts";
import { createSweepAuditTask, SWEEP_AUDIT_CRONTAB } from "./task/sweep-audit";
import {
  createSweepGenerationPartsTask,
  SWEEP_GENERATION_PARTS_CRONTAB,
} from "./task/sweep-generation-parts";
import {
  createSweepPullRequestsTask,
  SWEEP_PULL_REQUESTS_CRONTAB,
} from "./task/sweep-pull-requests";
import {
  createSweepSessionsTask,
  SWEEP_SESSIONS_CRONTAB,
} from "./task/sweep-sessions";
import {
  createSweepWebhookDeliveriesTask,
  SWEEP_WEBHOOK_DELIVERIES_CRONTAB,
} from "./task/sweep-webhook-deliveries";
import { loadEnvFiles } from "./env-file";
import { startWorker, type WorkerRunner } from "./runner";
import { buildLargePoolTaskList, buildTaskList } from "./task-list";
import { shapePlainHttpLogLine } from "./plain-http-warning";
import { buildToolAccessWarning } from "./tool-access";
import { checkTrackerBoot } from "./tracker-boot";
import {
  collectOutputSecrets,
  guardGeneratorOutput,
  listCredentialVars,
} from "./task/generate/logic/output-secret";

/** Where failed-generation raw outputs are dumped for debugging (ephemeral). */
const FAILURE_DUMP_DIR = "out";

function readEnv(): NodeJS.ProcessEnv {
  loadEnvFiles(process.cwd());
  return applyDefaultConfigPath(process.env, process.cwd());
}

// The one process logger: everything here, composition, task, graphile
// lifecycle, logs through it. Its own construction can fail on config (bad
// LOG_LEVEL); that too must stay down, and with the boundary broken, bare
// console is the only channel left.
const env = readEnv();
const logger = (() => {
  try {
    return createLogger({ env });
  } catch (error) {
    // oxlint-disable-next-line no-console -- the logging boundary itself failed to construct; bare console is the only channel left
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

function describeRetention(days: number | null): string {
  return days === null ? "unset (rows kept forever)" : `${days}d`;
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
  // fetch PR data, same credential set the web tier already requires.
  const githubConfig = loadGitHubConfig(env, {
    onWarning: (message) => logger.warn(message),
  });
  if (!githubConfig.ok) {
    exitOnConfigError(
      `worker composition: invalid GitHub configuration — ${githubConfig.error.issues.join("; ")}`,
    );
  }

  // The instance config (or zero-config default) selects the adapter; keys
  // resolve by env-var NAME and adapters run their startup checks here, a
  // misconfigured instance refuses boot before taking jobs.
  const generator = await createGenerator(config.value.generator, {
    env,
    failureDir: FAILURE_DUMP_DIR,
    // warn, not info: everything the registry surfaces here is
    // degraded/suspicious and should be alertable.
    log: (message) => logger.warn(message),
    onPlainHttp: (warning) => {
      const line = shapePlainHttpLogLine(warning);
      logger.warn(line.message, line.fields);
    },
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
  const toolAccess = buildToolAccessWarning(config.value.generator.provider);
  if (toolAccess !== undefined) {
    logger.warn(toolAccess.message, toolAccess.fields);
  }

  // The tracker config's boot checks, awaited before the runner starts.
  const trackerRoot = {
    env,
    contextSources: config.value.contextSources,
    trackers: config.value.trackers,
  };
  const jiraTransport = JiraTransports.HTTP.create();
  const trackerBoot = await checkTrackerBoot(trackerRoot, {
    jiraTransport,
    log: logger,
  });
  if (!trackerBoot.ok) {
    exitOnConfigError(trackerBoot.error);
  }

  // Pool error observer: a DB restart surfaces as warn lines, not an
  // unhandled-'error' process crash.
  const handle = createDb(config.value.databaseUrl, {
    onError: (error) => logger.warn("postgres client error", { err: error }),
    maxConnections: config.value.poolMax,
  });
  // Grants name their key by env-var NAME (keyRef); resolution is lazy, per
  // url-box job or swept grant, so an instance with neither never needs it.
  const keyProvider = createEnvKeyProvider(env);
  const urlBoxDeps: Mutable<UrlBoxAuthDeps> = { handle, keyProvider };
  // Awaited before the runner starts; a job denied while the lookup is
  // still pending retries.
  const configuredOperatorToken = githubConfig.value.operatorToken;
  if (configuredOperatorToken !== undefined) {
    urlBoxDeps.operatorToken = await resolveOperatorTokenOwner(
      configuredOperatorToken,
      { log: logger },
    );
  }
  const configuredEffort = config.value.generator.effort;
  const configuredFullRegeneration = config.value.generator.fullRegeneration;
  // The resolved values join the env so a file-sourced database URL or
  // private key is scanned for too.
  const outputSecrets = collectOutputSecrets(
    {
      ...env,
      DATABASE_URL: config.value.databaseUrl,
      GITHUB_APP_PRIVATE_KEY: githubConfig.value.privateKey,
    },
    listCredentialVars(config.value.generator, config.value.contextSources),
  );
  const appClient = createAppClient(githubConfig.value);
  const generateDeps: Mutable<GenerateTaskDeps> = {
    handle,
    generator: guardGeneratorOutput(generator.value, outputSecrets),
    github: createGitHubPort(createAppGitHubBinders(appClient), urlBoxDeps),
    publicBaseUrl: config.value.publicBaseUrl,
    translate: createI18n().t,
    spend: config.value.spend,
    contextProviders: createBuiltInContextProviders(config.value.linkFetch),
    trackerRoot,
    jiraTransport,
    siblingRepos: config.value.siblingRepos,
    revisionNarrative: config.value.revisionNarrative,
    hugeSpanRatio: config.value.hugeSpanRatio,
    detailConcurrency: config.value.detailConcurrency,
    forceMultiCall: config.value.forceMultiCall,
    log: logger,
  };

  // Absent → brief-core's medium default.
  if (configuredEffort !== undefined) {
    generateDeps.effort = configuredEffort;
  }
  // Absent → never.
  if (configuredFullRegeneration !== undefined) {
    generateDeps.fullRegeneration = configuredFullRegeneration;
  }

  const generate = createGenerateTask(generateDeps);
  const recoverGeneration = createRecoverGenerationTask(generateDeps);
  const syncEntry = createSyncEntryTask(generateDeps);
  const largePool = { pool: RunPools.LARGE };
  const generateLarge = createGenerateTask(generateDeps, largePool);
  const recoverGenerationLarge = createRecoverGenerationTask(
    generateDeps,
    largePool,
  );

  const sweepAudit = createSweepAuditTask({
    handle,
    retentionDays: config.value.auditRetentionDays,
    log: logger,
  });
  const sweepSessions = createSweepSessionsTask({
    handle,
    keyProvider,
    oauthApp: createOAuthApp({
      clientId: githubConfig.value.oauthClientId,
      clientSecret: githubConfig.value.oauthClientSecret,
    }),
    log: logger,
  });
  const sweepPullRequests = createSweepPullRequestsTask({
    handle,
    retentionDays: config.value.prRetentionDays,
    log: logger,
  });
  const sweepWebhookDeliveries = createSweepWebhookDeliveriesTask({
    handle,
    log: logger,
  });
  const reconcileWebhookDeliveries = createReconcileWebhookDeliveriesTask({
    listDeliveries: (cursor) => listHookDeliveries(appClient, cursor),
    redeliver: (deliveryId) => redeliverHookDelivery(appClient, deliveryId),
    log: logger,
    now: () => new Date(),
  });
  const sweepGenerationParts = createSweepGenerationPartsTask({
    handle,
    log: logger,
  });

  const runner = await startWorker({
    databaseUrl: config.value.databaseUrl,
    // MERGEBRIEF_AUTO_MIGRATE=false → read-only schema check at boot.
    autoMigrate: config.value.autoMigrate,
    runningVersion: config.value.serverVersion,
    log: logger,
    migrateCommand: resolveMigrateCommand(env[RUNTIME_MARKER_VAR]),
    concurrency: config.value.concurrency,
    largePool: {
      concurrency: config.value.largeConcurrency,
      taskList: buildLargePoolTaskList({
        generateLarge: (payload, helpers) => generateLarge(payload, helpers),
        recoverGenerationLarge: (payload, helpers) =>
          recoverGenerationLarge(payload, helpers),
      }),
    },
    poolMax: config.value.poolMax,
    // helpers.abortSignal is graphile's graceful-shutdown signal: SIGTERM
    // aborts an in-flight stream (job back to queue) instead of riding out the
    // kill grace into a stuck job lock. helpers.job carries the attempt counts
    // the failure events read.
    taskList: buildTaskList({
      generate: (payload, helpers) => generate(payload, helpers),
      recoverGeneration: (payload, helpers) =>
        recoverGeneration(payload, helpers),
      syncEntry: (payload, helpers) => syncEntry(payload, helpers),
      sweepAudit: () => sweepAudit(),
      sweepSessions: () => sweepSessions(),
      sweepPullRequests: () => sweepPullRequests(),
      sweepWebhookDeliveries: () => sweepWebhookDeliveries(),
      sweepGenerationParts: () => sweepGenerationParts(),
      reconcileWebhookDeliveries: () => reconcileWebhookDeliveries(),
    }),
    // Unset retention → a retention job still runs and deletes nothing.
    crontab: [
      SWEEP_AUDIT_CRONTAB,
      SWEEP_SESSIONS_CRONTAB,
      SWEEP_PULL_REQUESTS_CRONTAB,
      SWEEP_WEBHOOK_DELIVERIES_CRONTAB,
      SWEEP_GENERATION_PARTS_CRONTAB,
      RECONCILE_WEBHOOK_DELIVERIES_CRONTAB,
    ].join("\n"),
    // graphile's lifecycle logs flow through the logging boundary.
    logger: new GraphileLogger(createGraphileLogFactory(logger)),
  });
  const auditRetention = describeRetention(config.value.auditRetentionDays);
  const prRetention = describeRetention(config.value.prRetentionDays);
  const slots = `${config.value.concurrency} + ${config.value.largeConcurrency} large`;
  logger.info(
    `worker: listening for generate jobs; slots ${slots}; audit retention ${auditRetention}; pull request retention ${prRetention}`,
  );

  installStopSignals(runner);
  try {
    // Runs until a signal stops it; graphile owns the graceful part (stop
    // claiming, abort in-flight via helpers.abortSignal, release its pool).
    await runner.promise;
  } finally {
    try {
      await closeDb(handle);
    } finally {
      await stopTracing(logger);
    }
  }
  logger.info("worker: stopped");
}

/**
 * The first SIGTERM or SIGINT stops the runner gracefully, after which the
 * pool closes and the last spans flush; a second one exits at once. graphile
 * runs with its own handlers off, so nothing re-raises the signal mid-stop.
 */
function installStopSignals(runner: WorkerRunner): void {
  let stopping = false;
  const onSignal = (signal: NodeJS.Signals): void => {
    if (stopping) {
      logger.warn("worker: second stop signal, exiting now", { signal });
      process.exit(1);
    }
    stopping = true;
    logger.info("worker: stopping", { signal });
    runner.stop().catch((error: unknown) => {
      logger.warn("worker: stopping the runner failed", { err: error });
    });
  };
  process.on("SIGTERM", onSignal);
  process.on("SIGINT", onSignal);
}

// No argument: graphile sets its own exit code on a stop it decides, such
// as a breaking queue migration, and a bare exit keeps it.
main().then(
  () => process.exit(),
  (error: unknown) => {
    // Boot failures are the documented exemption to the message-only rule:
    // nothing provider-shaped reaches here, and the boundary's serializer scrubs
    // the URL-shaped secrets a migrate failure quotes back.
    logger.error("worker: boot failed", { err: error });
    process.exit(1);
  },
);
