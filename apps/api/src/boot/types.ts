import type { GitHubConfig } from "github";
import type { Logger } from "logging";
import type {
  EnsureAppSchemaOptions,
  PersistenceConfig,
  SchemaCheckError,
} from "persistence";
import type { LoadedInstancePolicy } from "generators/instance-policy";
import type { DraftPolicy, Result, ValueOf } from "types";
import type { ApiConfig } from "../config";

/** Process exit codes the two entries share. A service's config error exits
 * SUCCESS on purpose: a restart can never fix one, so under
 * `restart: on-failure` a zero exit stays down with the reason as the log's
 * last line. The one-shot migrate run exits FAILURE on the same error. */
export const ExitCodes = {
  SUCCESS: 0,
  FAILURE: 1,
} as const;
export type ExitCode = ValueOf<typeof ExitCodes>;

export interface BootConfig {
  readonly api: ApiConfig;
  readonly github: GitHubConfig;
  readonly persistence: PersistenceConfig;
  readonly draftPolicy: DraftPolicy;
  readonly spendPolicy: LoadedInstancePolicy["spendPolicy"];
  readonly operatorIds: LoadedInstancePolicy["operatorIds"];
  readonly allowedAccess: LoadedInstancePolicy["allowedAccess"];
}

/** The two values the migrate entry loads: nothing about GitHub, sessions
 * or draft policy gates a schema apply. */
export interface MigrateConfig {
  readonly databaseUrl: string;
  readonly runningVersion: string;
}

/** What the migrate run needs; the entry wires the real schema and queue
 * migrators, tests hand in recorders. */
export interface RunMigrateDeps {
  readonly databaseUrl: string;
  readonly runningVersion: string;
  readonly log: Logger;
  readonly ensure: (
    databaseUrl: string,
    options: EnsureAppSchemaOptions,
  ) => Promise<Result<undefined, SchemaCheckError>>;
  readonly migrateQueue: (databaseUrl: string) => Promise<void>;
}
