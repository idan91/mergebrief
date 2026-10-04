import { ExitCodes, type ExitCode, type RunMigrateDeps } from "./types";

/**
 * Apply every pending app-schema migration, then the queue schema, no matter
 * what `MERGEBRIEF_AUTO_MIGRATE` says: this run IS the manual step a
 * check-only boot refuses with. Same lock, same `instance_version` row, same
 * log lines as an auto-migrating boot.
 */
export async function runMigrate(deps: RunMigrateDeps): Promise<ExitCode> {
  try {
    const ensured = await deps.ensure(deps.databaseUrl, {
      autoMigrate: true,
      runningVersion: deps.runningVersion,
      log: deps.log,
    });
    if (!ensured.ok) {
      deps.log.error(`migrate: ${ensured.error.message}`);
      return ExitCodes.FAILURE;
    }
    await deps.migrateQueue(deps.databaseUrl);
  } catch (error) {
    deps.log.error("migrate: failed", { err: error });
    return ExitCodes.FAILURE;
  }

  deps.log.info("migrate: schema current", { version: deps.runningVersion });
  return ExitCodes.SUCCESS;
}
