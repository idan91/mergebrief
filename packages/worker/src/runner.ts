// Runner bootstrap: ONE long-lived graphile-worker runner over the same
// Postgres that holds the app schema. Boot order matters and is owned here:
//   1. app-schema migrations (drizzle, idempotent);
//   2. queue-schema migrations (graphile-owned, idempotent);
//   3. start the runner with the injected task list.
// Both migrators no-op when current, so every process (worker, web, smoke) can
// run them at boot without coordination.
//
// SHUTDOWN: graphile installs SIGTERM/SIGINT handlers itself and shuts down
// GRACEFULLY — stops claiming jobs, signals in-flight tasks via
// `helpers.abortSignal`, releases its pool. `main.ts` awaits `runner.promise`
// and releases the persistence pool after.
import {
  run,
  runMigrations,
  type Logger as GraphileLogger,
  type Runner,
  type TaskList,
} from "graphile-worker";
import { ensureAppSchema } from "persistence";

/**
 * One slot keeps a self-hosted worker's spend and memory bounded, and the
 * daily generation cap's accuracy assumes it: at concurrency C the gate admits
 * up to `cap + C - 1` runs.
 */
const DEFAULT_CONCURRENCY = 1;

export interface StartWorkerOptions {
  readonly databaseUrl: string;
  /** The registered tasks — the `generate` task in production. */
  readonly taskList: TaskList;
  readonly concurrency?: number;
  /** The logging-boundary adapter — omitted = graphile's console default. */
  readonly logger?: GraphileLogger;
  /** false = check-only (refuse boot when the schema is behind instead of
   * applying DDL). Omitted = apply. */
  readonly autoMigrate?: boolean;
}

/**
 * Migrate (app schema, then queue schema — both idempotent) and start the
 * long-lived runner. Resolves once the runner is LISTENING; the returned
 * `Runner.promise` settles when it stops (signal-driven graceful shutdown).
 * Under `autoMigrate: false` the app-schema step is a read-only check that
 * throws the operator refusal when the database is behind. The graphile step
 * stays as-is either way: graphile owns its schema and no-ops read-only when
 * current.
 */
export async function startWorker(
  options: StartWorkerOptions,
): Promise<Runner> {
  const ensured = await ensureAppSchema(options.databaseUrl, {
    autoMigrate: options.autoMigrate ?? true,
  });
  if (!ensured.ok) {
    throw new Error(`worker boot: ${ensured.error.message}`);
  }
  await runMigrations({ connectionString: options.databaseUrl });
  return run({
    connectionString: options.databaseUrl,
    concurrency: options.concurrency ?? DEFAULT_CONCURRENCY,
    taskList: options.taskList,
    ...(options.logger === undefined ? {} : { logger: options.logger }),
  });
}
