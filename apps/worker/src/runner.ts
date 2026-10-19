// Boot app-schema migrations before graphile's queue migrations, then start the runner.
// Both migrators are idempotent across processes. Graphile owns graceful signal handling,
// job claiming and its pool; main releases the persistence pool after runner.promise settles.
import {
  parseCrontab,
  run,
  runMigrations,
  type Logger as GraphileLogger,
  type Runner,
  type RunnerOptions,
  type TaskList,
} from "graphile-worker";
import type { Logger } from "logging";
import type { Mutable } from "types/utils";
import {
  ensureAppSchema,
  type EnsureAppSchemaOptions,
  type MigrateCommand,
} from "persistence";

/** One slot keeps a self-hosted worker's spend and memory bounded by default. */
const DEFAULT_CONCURRENCY = 1;

export interface StartWorkerOptions {
  readonly databaseUrl: string;
  /** The registered tasks: `generate`, `recover-generation` and the scheduled sweeps in production. */
  readonly taskList: TaskList;
  /** Crontab text for the scheduled jobs. REQUIRED, so a refactor cannot drop
   * the schedule and leave a green build with nothing sweeping. */
  readonly crontab: string;
  readonly concurrency?: number;
  /** The logging-boundary adapter, omitted = graphile's console default. */
  readonly logger?: GraphileLogger;
  /** false = check-only (refuse boot when the schema is behind instead of
   * applying DDL). Omitted = apply. */
  readonly autoMigrate?: boolean;
  /** Recorded in `instance_version` once the schema is current; omitted
   * leaves the row alone (tests). Needs `log` to say so. */
  readonly runningVersion?: string;
  readonly log?: Logger;
  /** Named in a check-only refusal; omitted = the checkout command. */
  readonly migrateCommand?: MigrateCommand;
}

/**
 * graphile registers a crontab naming an unknown task without complaint and
 * then queues jobs nobody claims, and it never notices a schedule the task
 * list has dropped either. Both drifts are silent in production, so the boot
 * refuses instead.
 */
export function assertScheduledTasksRegistered(
  crontab: string,
  taskList: TaskList,
): void {
  for (const item of parseCrontab(crontab)) {
    if (!Object.hasOwn(taskList, item.task)) {
      throw new Error(
        `worker boot: crontab schedules "${item.task}", which is not a registered task`,
      );
    }
  }
}

/**
 * Resolve once listening; Runner.promise settles on shutdown. With autoMigrate false,
 * check app-schema currency read-only and refuse stale databases. Graphile still owns
 * its schema and performs a read-only no-op when current.
 */
export async function startWorker(
  options: StartWorkerOptions,
): Promise<Runner> {
  // Before any DDL: a schedule nobody handles is a config error, and a config
  // error must not migrate first.
  assertScheduledTasksRegistered(options.crontab, options.taskList);
  const schemaOptions: Mutable<EnsureAppSchemaOptions> = {
    autoMigrate: options.autoMigrate ?? true,
  };
  if (options.runningVersion !== undefined && options.log !== undefined) {
    schemaOptions.runningVersion = options.runningVersion;
    schemaOptions.log = options.log;
  }
  if (options.migrateCommand !== undefined) {
    schemaOptions.migrateCommand = options.migrateCommand;
  }
  const ensured = await ensureAppSchema(options.databaseUrl, schemaOptions);
  if (!ensured.ok) {
    throw new Error(`worker boot: ${ensured.error.message}`);
  }
  await runMigrations({ connectionString: options.databaseUrl });

  const runnerOptions: RunnerOptions = {
    connectionString: options.databaseUrl,
    concurrency: options.concurrency ?? DEFAULT_CONCURRENCY,
    taskList: options.taskList,
    crontab: options.crontab,
    // The process owns its stop signals, so its shutdown path can close the
    // pool and flush spans before exiting; graphile's would re-raise first.
    noHandleSignals: true,
  };

  if (options.logger !== undefined) {
    runnerOptions.logger = options.logger;
  }

  return run(runnerOptions);
}
