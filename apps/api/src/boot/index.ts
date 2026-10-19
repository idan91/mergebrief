// The pieces both entries (`main.ts`, `migrate.ts`) share: build the logger,
// load every config block or exit. Each entry reads env itself (the
// composition-root rule); nothing here constructs a database or a server.
import { loadInstancePolicy } from "generators/instance-policy";
import { loadConfig as loadGitHubConfig } from "github";
import { createLogger, type Logger } from "logging";
import { loadConfig as loadPersistenceConfig } from "persistence";
import { loadConfig, loadServerVersion } from "../config";
import {
  ExitCodes,
  type BootConfig,
  type ExitCode,
  type MigrateConfig,
} from "./types";

/** The logging boundary, or exit with the entry's config-error code: with
 * no logger there is no channel left but the bare console. */
export function createBootLogger(
  env: NodeJS.ProcessEnv,
  configExitCode: ExitCode = ExitCodes.SUCCESS,
): Logger {
  try {
    return createLogger({ env });
  } catch (error) {
    // oxlint-disable-next-line no-console -- the logging boundary itself failed to construct; bare console is the only channel left
    console.error("api composition: invalid logging configuration", error);
    process.exit(configExitCode);
  }
}

/** Log the config error and exit with the code the entry chose. */
export function exitOnConfigError(
  logger: Logger,
  message: string,
  code: ExitCode = ExitCodes.SUCCESS,
): never {
  logger.error(message);
  process.exit(code);
}

/** Every config block, or the process exits before anything is constructed,
 * with `configExitCode` (the service's SUCCESS by default). */
export function loadBootConfig(
  env: NodeJS.ProcessEnv,
  logger: Logger,
  configExitCode: ExitCode = ExitCodes.SUCCESS,
): BootConfig {
  const config = loadConfig(env);
  if (!config.ok) {
    exitOnConfigError(
      logger,
      `api composition: invalid configuration: ${config.error.issues.join("; ")}`,
      configExitCode,
    );
  }
  const githubConfig = loadGitHubConfig(env, {
    onWarning: (message) => logger.warn(message),
  });
  if (!githubConfig.ok) {
    exitOnConfigError(
      logger,
      `api composition: invalid GitHub configuration: ${githubConfig.error.issues.join("; ")}`,
      configExitCode,
    );
  }
  const persistenceConfig = loadPersistenceConfig(env, {
    onWarning: (message) => logger.warn(message),
  });
  if (!persistenceConfig.ok) {
    exitOnConfigError(
      logger,
      `api composition: invalid persistence configuration: ${persistenceConfig.error.issues.join("; ")}`,
      configExitCode,
    );
  }
  // The drafts, spend and operators blocks only: the generator block is the
  // worker's concern, so this process needs no adapter validation and no
  // provider keys.
  const instancePolicy = loadInstancePolicy(env);
  if (!instancePolicy.ok) {
    exitOnConfigError(
      logger,
      `api composition: invalid instance policy: ${instancePolicy.error.issues.join("; ")}`,
      configExitCode,
    );
  }

  return {
    api: config.value,
    github: githubConfig.value,
    persistence: persistenceConfig.value,
    draftPolicy: instancePolicy.value.draftPolicy,
    spendPolicy: instancePolicy.value.spendPolicy,
    operatorIds: instancePolicy.value.operatorIds,
  };
}

/** The migrate entry's config: the database and the version it records,
 * or exit with `configExitCode`. An unset or broken GitHub, session or draft
 * setting never blocks a schema apply. */
export function loadMigrateConfig(
  env: NodeJS.ProcessEnv,
  logger: Logger,
  configExitCode: ExitCode,
): MigrateConfig {
  const persistenceConfig = loadPersistenceConfig(env, {
    onWarning: (message) => logger.warn(message),
  });
  if (!persistenceConfig.ok) {
    exitOnConfigError(
      logger,
      `migrate: invalid persistence configuration: ${persistenceConfig.error.issues.join("; ")}`,
      configExitCode,
    );
  }
  const serverVersion = loadServerVersion(env);
  if (!serverVersion.ok) {
    exitOnConfigError(
      logger,
      `migrate: invalid configuration: ${serverVersion.error.issues.join("; ")}`,
      configExitCode,
    );
  }

  return {
    databaseUrl: persistenceConfig.value.databaseUrl,
    runningVersion: serverVersion.value,
  };
}
