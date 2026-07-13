// The worker composition root (`pnpm start` / the compose `worker` service).
// This is the ONE place env is read and real dependencies are wired — the
// library modules stay env-INJECTED (same posture as
// `apps/web/src/server/webhookApp.ts`). A misconfigured worker must fail
// LOUDLY at boot, never limp into draining jobs it cannot complete.
import Anthropic from "@anthropic-ai/sdk";
import { AnthropicGenerator } from "generators";
import { createAppClient, loadConfig as loadGitHubConfig } from "github";
import { closeDb, createDb } from "persistence";
import { loadConfig } from "./config";
import { appGitHubPort } from "./github-port";
import { createGenerateTask } from "./generate";
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

async function main(): Promise<void> {
  const env = readEnv();

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

  const handle = createDb(config.value.databaseUrl);
  const generate = createGenerateTask({
    handle,
    generator: new AnthropicGenerator(
      new Anthropic({ apiKey: config.value.providerApiKey }),
      FAILURE_DUMP_DIR,
    ),
    github: appGitHubPort(createAppClient(githubConfig.value)),
    publicBaseUrl: config.value.publicBaseUrl,
    log: (message) => console.error(`[worker] ${message}`),
  });

  const runner = await startWorker({
    databaseUrl: config.value.databaseUrl,
    // helpers.abortSignal is graphile's graceful-shutdown signal — threading
    // it through lets SIGTERM abort an in-flight stream (job back to queue)
    // instead of riding out the kill grace into a stuck job lock.
    taskList: { generate: (payload, helpers) => generate(payload, helpers) },
  });
  console.error("worker: listening for generate jobs");

  try {
    // Runs until a signal stops it; graphile owns the graceful part (stop
    // claiming, abort in-flight via helpers.abortSignal, release its pool).
    await runner.promise;
  } finally {
    await closeDb(handle);
  }
  console.error("worker: stopped");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
