// The telemetry preload and the worker's second composition root: the image runs
// `node --import tsx --import ./src/instrument.ts src/main.ts`, so tracing
// starts before main.ts imports what it instruments. It reads telemetry
// config only.
import { createLogger, type Logger } from "logging";
import { startTracing, TracingStatuses } from "logging/tracing";
import { loadEnvFiles } from "./env-file";

const SERVICE_NAME = "mergebrief-worker";
// A config error exits 0, as main.ts does: a restart can never fix one.
const CONFIG_ERROR_EXIT_CODE = 0;

function readEnv(): NodeJS.ProcessEnv {
  loadEnvFiles(process.cwd());
  return process.env;
}

async function startWorkerTracing(): Promise<void> {
  const env = readEnv();
  let logger: Logger;
  try {
    logger = createLogger({ env });
  } catch {
    // main.ts reports the invalid logging configuration and exits.
    return;
  }

  const tracing = await startTracing({
    env,
    serviceName: SERVICE_NAME,
    log: logger,
  });
  if (!tracing.ok) {
    logger.error(
      `worker composition: invalid tracing configuration: ${tracing.error}`,
    );
    process.exit(CONFIG_ERROR_EXIT_CODE);
  }
  if (tracing.value === TracingStatuses.ON) {
    logger.info("tracing on");
  }
}

await startWorkerTracing();
