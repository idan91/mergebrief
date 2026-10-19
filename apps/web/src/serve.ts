// The production web process: `docker-entrypoint.sh web` runs this file over
// the built output in `dist/`. Its composition root: config is read here.
import { fileURLToPath } from "node:url";
import { SUBMIT_TIMEOUT_MS } from "./server/api/consts";
import { getServerEnv } from "./server/env";
import { getServerLogger } from "./server/logger";
import { loadWebServerConfig } from "./server/serve/config";
import { indexStaticFiles } from "./server/serve/static-files";
import { loadServerEntry, startWebServer, stopWebServer } from "./server/serve";

const SERVER_BUNDLE = new URL("../dist/server/server.js", import.meta.url);
const CLIENT_DIR = fileURLToPath(new URL("../dist/client", import.meta.url));

const logger = getServerLogger();
const config = loadWebServerConfig(getServerEnv());
if (!config.ok) {
  logger.error("web boot refused", { reason: config.error });
  process.exit(1);
}

const server = await startWebServer({
  ...config.value,
  fetch: await loadServerEntry(SERVER_BUNDLE),
  staticFiles: await indexStaticFiles(CLIENT_DIR),
  logger,
});
logger.info("web listening", { port: config.value.port });

// The drain matches the longest request the proxy allows, a review submit, so
// a stop never cuts one the browser is still waiting on.
async function drainAndExit(signal: NodeJS.Signals): Promise<never> {
  logger.info("web draining", { signal });
  const outcome = await stopWebServer(server, SUBMIT_TIMEOUT_MS);
  logger.info("web stopped", { outcome });
  process.exit(0);
}

process.once("SIGTERM", (signal) => void drainAndExit(signal));
process.once("SIGINT", (signal) => void drainAndExit(signal));
