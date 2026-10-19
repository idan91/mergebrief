// The telemetry preload and the web tier's second composition root: the image
// runs `node --import tsx --import ./src/instrument.ts src/serve.ts`, so
// tracing starts before the server imports what it instruments. It reads
// telemetry config only.
import type { Logger } from "logging";
import { startTracing, TracingStatuses } from "logging/tracing";
import { getServerEnv } from "./server/env";
import { getServerLogger } from "./server/logger";

const SERVICE_NAME = "mergebrief-web";
// The bundle's static files: a cold page load would otherwise be a root trace
// per asset.
const UNTRACED_PATH_PREFIXES = ["/assets/", "/favicon.svg"];

async function startWebTracing(): Promise<void> {
  const env = getServerEnv();
  let logger: Logger;
  try {
    logger = getServerLogger();
  } catch {
    // serve.ts reports the invalid logging configuration and exits.
    return;
  }

  const tracing = await startTracing({
    env,
    serviceName: SERVICE_NAME,
    log: logger,
    untracedPathPrefixes: UNTRACED_PATH_PREFIXES,
  });
  if (!tracing.ok) {
    logger.error("web boot refused", {
      reason: `invalid tracing configuration: ${tracing.error}`,
    });
    process.exit(1);
  }
  if (tracing.value === TracingStatuses.ON) {
    logger.info("tracing on");
  }
}

await startWebTracing();
