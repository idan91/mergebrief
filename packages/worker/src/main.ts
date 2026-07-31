// The worker composition root (`pnpm start` / the compose `worker` service).
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
 * Mirrors the web composition root's `readEnv`: the file is optional.
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
const env = readEnv();
const logger = createLogger({ env });

async function main(): Promise<void> {
  const config = loadConfig(env);
  if (!config.ok) {
    throw new Error(
      `worker composition: invalid configuration — ${config.error.issues.join("; ")}`,
    );
  }
  // The worker authenticates to GitHub as the App (installation tokens) to
  // fetch PR data — same credential set the web tier already requires.
  const githubConfig = loadGitHubConfig(env);
  if (!githubConfig.ok) {
    throw new Error(
      `worker composition: invalid GitHub configuration — ${githubConfig.error.issues.join("; ")}`,
    );
  }

  // Generator construction goes through the registry seam (BRIEF-11): the
  // instance config (or zero-config default) selects the adapter; keys
  // resolve by env-var NAME and harness adapters run their boot probes here
  // — a misconfigured instance refuses boot before taking jobs.
  const generator = await createGenerator(config.value.generator, {
    env,
    failureDir: FAILURE_DUMP_DIR,
    log: (message) => logger.info(message),
  });
  if (!generator.ok) {
    throw new Error(
      `worker composition: invalid generator configuration — ${generator.error.issues.join("; ")}`,
    );
  }

  // Pool error observer (ADR 0034 #7 posture, mirrors the web tier): a DB
  // restart surfaces as warn lines, not an unhandled-'error' process crash.
  const handle = createDb(config.value.databaseUrl, {
    onError: (error) => logger.warn("postgres pool error (idle client)", { err: error }),
  });
  const configuredEffort = config.value.generator.effort;
  const generate = createGenerateTask({
    handle,
    generator: generator.value,
    github: appGitHubPort(createAppClient(githubConfig.value)),
    publicBaseUrl: config.value.publicBaseUrl,
    // Instance-config effort (BRIEF-75); absent → brief-core's medium default.
    ...(configuredEffort === undefined ? {} : { effort: configuredEffort }),
    log: logger,
  });

  const runner = await startWorker({
    databaseUrl: config.value.databaseUrl,
    // helpers.abortSignal is graphile's graceful-shutdown signal — threading
    // it through lets SIGTERM abort an in-flight stream (job back to queue)
    // instead of riding out the kill grace into a stuck job lock. helpers.job
    // carries the attempt counts the failure events read.
    taskList: { generate: (payload, helpers) => generate(payload, helpers) },
    // graphile's lifecycle logs (jobId/workerId scope) flow through the seam.
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
  // Structured `err`, not message-into-msg: the seam's serializer scrubs
  // URL-shaped secrets (BRIEF-88) — a drizzle migrate failure quotes
  // DATABASE_URL back, which the old message-only line emitted verbatim.
  logger.error("worker: boot failed", { err: error });
  process.exit(1);
});
