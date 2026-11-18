// The migrate entry (`pnpm -C apps/api migrate`, `docker compose run --rm api
// migrate`): the one command an operator runs when boot is check-only. Reads
// env, loads the database and the version, applies, exits.
import { ensureAppSchema } from "persistence";
import { createBootLogger, loadMigrateConfig } from "./boot";
import { loadEnvFiles } from "./boot/env-file";
import { runMigrate } from "./boot/migrate";
import { ExitCodes } from "./boot/types";
import { migrateQueue } from "./queue";

/** A value already in the shell, such as a DDL `DATABASE_URL` prefixed on
 * the command line, is never overwritten. */
function readEnv(): NodeJS.ProcessEnv {
  loadEnvFiles(process.cwd());
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
