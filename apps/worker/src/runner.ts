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
/** graphile holds a connection per slot plus its listener and its job release. */
const LARGE_POOL_SPARE_CONNECTIONS = 2;

/** The second runner: the large pool's tasks, drained by their own slots. */
export interface LargePoolOptions {
  readonly taskList: TaskList;
  readonly concurrency: number;
}

/** Both runners as one: listening once both listen, stopped and settled together. */
export interface WorkerRunner {
  /** Settles when every runner stopped; rejects when one failed. */
  readonly promise: Promise<void>;
  stop(): Promise<void>;
}

export interface StartWorkerOptions {
  readonly databaseUrl: string;
  /** The registered tasks: `generate`, `recover-generation` and the scheduled sweeps in production. */
  readonly taskList: TaskList;
  /** Crontab text for the scheduled jobs. REQUIRED, so a refactor cannot drop
   * the schedule and leave a green build with nothing sweeping. */
  readonly crontab: string;
  readonly concurrency?: number;
  /** The large pool beside the first runner; omitted starts none. */
  readonly largePool?: LargePoolOptions;
  /** graphile's own pool size (`DATABASE_POOL_MAX`); omitted = graphile's 10. */
  readonly poolMax?: number;
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
 * Resolve once listening; the runner's promise settles on shutdown. With
 * autoMigrate false, check app-schema currency read-only and refuse stale
 * databases. Graphile still owns its schema and performs a read-only no-op
 * when current. The crontab rides the first runner only; the large pool's
 * runner drains its own task list and nothing scheduled.
 */
export async function startWorker(
  options: StartWorkerOptions,
): Promise<WorkerRunner> {
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
  if (options.poolMax !== undefined) {
    runnerOptions.maxPoolSize = options.poolMax;
  }

  const first = await run(runnerOptions);
  if (options.largePool === undefined) {
    return joinRunners([first]);
  }

  try {
    const large = await runLargePool(options, options.largePool);
    return joinRunners([first, large]);
  } catch (error) {
    // The first runner may already hold job locks; a process that exits
    // with it running strands them until graphile's lock timeout.
    await first.stop();
    throw error;
  }
}

/**
 * The large pool shares the first runner's database and logger, with a pool
 * sized to its own slots: graphile opens one pool per `run()`.
 */
function runLargePool(
  options: StartWorkerOptions,
  largePool: LargePoolOptions,
): Promise<Runner> {
  const largeOptions: RunnerOptions = {
    connectionString: options.databaseUrl,
    concurrency: largePool.concurrency,
    taskList: largePool.taskList,
    maxPoolSize: largePool.concurrency + LARGE_POOL_SPARE_CONNECTIONS,
    noHandleSignals: true,
  };
  if (options.logger !== undefined) {
    largeOptions.logger = options.logger;
  }
  return run(largeOptions);
}

function joinRunners(runners: readonly Runner[]): WorkerRunner {
  return {
    promise: Promise.all(runners.map((runner) => runner.promise)).then(
      () => undefined,
    ),
    async stop() {
      await Promise.all(runners.map((runner) => runner.stop()));
    },
  };
}
