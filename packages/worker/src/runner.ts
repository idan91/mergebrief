// Runner bootstrap (BRIEF-3 Part 1, ADR 0015): ONE long-lived graphile-worker
// runner over the same Postgres that holds the app schema — store, queue, and
// lock in a single stateful dependency. Boot order matters and is owned here:
//   1. app-schema migrations (drizzle, idempotent — `persistence.migrateApp`);
//   2. queue-schema migrations (graphile-owned, idempotent — its own
//      `runMigrations`, mirroring `packages/api/src/queue.ts`);
//   3. start the runner with the injected task list.
// Both migrators no-op when current, so every process (worker, web, smoke) can
// run them at boot without coordination.
//
// SHUTDOWN: graphile installs SIGTERM/SIGINT handlers itself
// (`noHandleSignals` stays default-false) and shuts down GRACEFULLY — it stops
// claiming new jobs, signals in-flight tasks via `helpers.abortSignal` (the
// Part 3 cancellation hook), and releases its pool. The composition root
// awaits `runner.promise` and releases ITS resources (the persistence pool)
// after — see `main.ts`.
import {
  run,
  runMigrations,
  type Logger as GraphileLogger,
  type Runner,
  type TaskList,
} from "graphile-worker";
import { ensureAppSchema } from "persistence";

/**
 * Generation jobs are minutes-long LLM streams, and single-flight per PR is
 * already graphile-owned (`job_key = generate:<pr>`); one slot keeps a
 * self-hosted worker's spend and memory bounded (ADR 0015 volume: bursty,
 * ~hundreds of jobs/day — parallelism is not the bottleneck, the model is).
 */
const DEFAULT_CONCURRENCY = 1;

export interface StartWorkerOptions {
  readonly databaseUrl: string;
  /** The registered tasks — the `generate` task (Part 2) in production. */
  readonly taskList: TaskList;
  readonly concurrency?: number;
  /** graphile logger (ADR 0034: the seam adapter) — omitted = graphile's console default. */
  readonly logger?: GraphileLogger;
  /** BRIEF-131: false = check-only (refuse boot when the schema is behind
   * instead of applying DDL). Omitted = apply, the historical behavior. */
  readonly autoMigrate?: boolean;
}

/**
 * Migrate (app schema, then queue schema — both idempotent) and start the
 * long-lived runner. Resolves once the runner is LISTENING; the returned
 * `Runner.promise` settles when it stops (signal-driven graceful shutdown).
 * Under `autoMigrate: false` the app-schema step is a read-only check that
 * throws the operator refusal when the database is behind (BRIEF-131). The
 * graphile step stays as-is either way: graphile owns its schema and no-ops
 * read-only when current (a version bump needing DDL under a restricted
 * role fails loudly here — documented in docs/self-host/operations.md).
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
