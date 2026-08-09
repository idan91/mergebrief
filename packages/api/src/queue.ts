// Persistence calls `graphile_worker.add_job` by name (it takes no
// `graphile-worker` npm dependency), so a startup wiring must install this
// schema BEFORE the first enqueue reaches a real Postgres. Install side only:
// nothing here starts a worker, polls, or subscribes to jobs.
import { runMigrations } from "graphile-worker";

/**
 * Idempotently install/upgrade the `graphile_worker` schema. Opens its own
 * short-lived pool and releases it before resolving — it does NOT start a
 * worker or hold a connection open.
 */
export async function migrateQueue(connectionString: string): Promise<void> {
  await runMigrations({ connectionString });
}
