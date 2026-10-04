// The migrate entry (`pnpm -C apps/api migrate`, `docker compose run --rm api
// migrate`): the one command an operator runs when boot is check-only. Reads
// env, loads the database and the version, applies, exits.
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureAppSchema } from "persistence";
import { createBootLogger, loadMigrateConfig } from "./boot";
import { runMigrate } from "./boot/migrate";
import { ExitCodes } from "./boot/types";
import { migrateQueue } from "./queue";

const WORKSPACE_ROOT_ENV_FILE = resolve(
  fileURLToPath(new URL("../../../.env", import.meta.url)),
);

/** Load the app's `.env`, then the workspace root's (compose's), then
 * return the ambient env. A value already in the shell, such as a DDL
 * `DATABASE_URL` prefixed on the command line, is never overwritten. */
function readEnv(): NodeJS.ProcessEnv {
  for (const file of [undefined, WORKSPACE_ROOT_ENV_FILE]) {
    try {
      process.loadEnvFile(file);
    } catch {
      // No such file; the required vars may still be set in the ambient env.
    }
  }
  return process.env;
}

// A one-shot run: its exit code is its whole answer, so a config error is a
// FAILURE here, unlike the service's stay-down SUCCESS.
const env = readEnv();
const logger = createBootLogger(env, ExitCodes.FAILURE);
const config = loadMigrateConfig(env, logger, ExitCodes.FAILURE);

const code = await runMigrate({
  databaseUrl: config.databaseUrl,
  runningVersion: config.runningVersion,
  log: logger,
  ensure: ensureAppSchema,
  migrateQueue,
});
process.exit(code);
