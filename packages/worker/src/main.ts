// The worker composition root (`pnpm start` / the compose `worker` service).
// This is the ONE place env is read and real dependencies are wired — the
// library modules stay env-INJECTED (same posture as
// `apps/web/src/server/webhookApp.ts`). A misconfigured worker must fail
// LOUDLY at boot, never limp into draining jobs it cannot complete.
//
// Part 1 scope: boot → migrate (app + queue schema, idempotent) → run →
// graceful signal-driven shutdown. The `generate` task registers here in
// Part 2; until then the runner starts with an empty task list and drains
// nothing (enqueued jobs simply wait).
import { loadConfig } from "./config";
import { startWorker } from "./runner";

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
  const config = loadConfig(readEnv());
  if (!config.ok) {
    throw new Error(
      `worker composition: invalid configuration — ${config.error.issues.join("; ")}`,
    );
  }

  const runner = await startWorker({
    databaseUrl: config.value.databaseUrl,
    taskList: {},
  });
  console.error("worker: listening for generate jobs");

  // Runs until a signal stops it; graphile owns the graceful part (stop
  // claiming, abort in-flight via helpers.abortSignal, release its pool).
  await runner.promise;
  console.error("worker: stopped");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
