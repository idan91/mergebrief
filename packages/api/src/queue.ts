// Queue schema bootstrap (BRIEF-2 stage 5). The webhook enqueues a `generate`
// job by calling `graphile_worker.add_job` inside persistence's ingest
// transaction (by-name SQL — persistence takes no `graphile-worker` npm
// dependency). That SQL function only exists once graphile-worker's
// `graphile_worker` schema is installed, so a composition root must install it
// BEFORE the first enqueue reaches a real Postgres.
//
// SCOPE — BRIEF-2 only INSTALLS/updates the schema (the enqueue side). The
// worker process that DRAINS `graphile_worker.jobs` and runs the generation is
// BRIEF-3: nothing here starts a worker, polls, or subscribes to jobs.
//
// This changes nothing about persistence's design: `ingest` still calls
// `add_job` by name, and the PGlite `graphile_worker` stub still stands in for
// this schema in unit tests. `migrateQueue` runs only against the real
// Postgres of a live deployment (or the stage-5 compose smoke).
import { runMigrations } from "graphile-worker";

/**
 * Idempotently install/upgrade the `graphile_worker` schema on the target
 * database. Safe to call repeatedly: graphile-worker records applied
 * migrations and no-ops when the schema is already current. Opens its own
 * short-lived pool and releases it before resolving — it does NOT start a
 * worker or hold a connection open.
 */
export async function migrateQueue(connectionString: string): Promise<void> {
  await runMigrations({ connectionString });
}
