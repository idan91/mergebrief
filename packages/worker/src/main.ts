// The worker startup wiring (`pnpm start` / the compose `worker` service).
// This is the ONE place env is read and real dependencies are wired — the
// library modules stay env-INJECTED (same posture as
// `apps/web/src/server/webhookApp.ts`). A misconfigured worker must fail
// LOUDLY at boot, never limp into draining jobs it cannot complete.
import { createGenerator } from "generators";
import { createAppClient, loadConfig as loadGitHubConfig } from "github";
import { Logger as GraphileLogger } from "graphile-worker";
import { createGraphileLogFactory, createLogger } from "logging";
import { closeDb, createDb } from "persistence";
import { loadConfig } from "./config";
import { appGitHubPort } from "./task/github-port";
import { createGenerateTask } from "./task/generate";
import { startWorker } from "./runner";

/** Where failed-generation raw outputs are dumped for debugging (ephemeral). */
const FAILURE_DUMP_DIR = "out";

/**
 * Load `packages/worker/.env` if present, then return the ambient env.
 * Mirrors the web startup wiring's `readEnv`: the file is optional.
 */
function readEnv(): NodeJS.ProcessEnv {
  try {
    process.loadEnvFile();
  } catch {
    // No .env file — the required vars may still be set in the ambient env.
  }
  return process.env;
}

// The process logger (ADR 0034): built once from the loaded env; everything
// in this process — composition, task, graphile lifecycle — logs through it.
// Its own construction can fail on config (bad LOG_LEVEL) — that too must
// stay down (BRIEF-149), and with the boundary itself broken, bare console is
// the honest fallback.
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
 * Config errors exit 0 (BRIEF-149): deterministic — a restart can never fix
 * one, so under the compose worker's `restart: on-failure` policy a zero
 * exit stays down (no restart loop) with the reason as the log's last line.
 * (In NDJSON mode pino's destination is synchronous, so the line lands
 * before the exit; the dev pino-pretty transport is async and may drop it —
 * accepted, compose is the contract here.) Transient faults keep the
 * throw → exit(1) path and its restart self-heal.
 */
function exitOnConfigError(message: string): never {
  logger.error(message);
  process.exit(0);
}

async function main(): Promise<void> {
  // The DATABASE_URL_FILE shadow warning (BRIEF-131) must reach the operator.
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

  // Generator construction goes through the registry boundary (BRIEF-11): the
  // instance config (or zero-config default) selects the adapter; keys
  // resolve by env-var NAME and harness adapters run their startup checks here
  // — a misconfigured instance refuses boot before taking jobs.
  const generator = await createGenerator(config.value.generator, {
    env,
    failureDir: FAILURE_DUMP_DIR,
    // warn, not info: everything the registry surfaces through this sink is
    // degraded/suspicious (served-model mismatch, billing-floor and
    // billing-route warnings — BRIEF-150) and should be alertable (ADR 0034 #5).
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

  // Pool error observer (ADR 0034 #7 posture, mirrors the web tier): a DB
  // restart surfaces as warn lines, not an unhandled-'error' process crash.
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
    // Instance-config effort (BRIEF-75); absent → brief-core's medium default.
    ...(configuredEffort === undefined ? {} : { effort: configuredEffort }),
    // Cross-revision regeneration policy (BRIEF-143); absent → never.
    ...(configuredFullRegeneration === undefined
      ? {}
      : { fullRegeneration: configuredFullRegeneration }),
    // The daily generation cap (BRIEF-20); no `spend` block → uncapped.
    spend: config.value.spend,
    log: logger,
  });

  const runner = await startWorker({
    databaseUrl: config.value.databaseUrl,
    // MERGEBRIEF_AUTO_MIGRATE=false → read-only schema check at boot.
    autoMigrate: config.value.autoMigrate,
    // helpers.abortSignal is graphile's graceful-shutdown signal — threading
    // it through lets SIGTERM abort an in-flight stream (job back to queue)
    // instead of riding out the kill grace into a stuck job lock. helpers.job
    // carries the attempt counts the failure events read.
    taskList: { generate: (payload, helpers) => generate(payload, helpers) },
    // graphile's lifecycle logs (jobId/workerId scope) flow through the boundary.
    logger: new GraphileLogger(createGraphileLogFactory(logger)),
  });
  logger.info("worker: listening for generate jobs");

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
  // Structured `err`, not message-into-msg: the boundary's serializer scrubs
  // URL-shaped secrets (BRIEF-88) — a drizzle migrate failure quotes
  // DATABASE_URL back, which the old message-only line emitted verbatim.
  logger.error("worker: boot failed", { err: error });
  process.exit(1);
});
