// Cross-package test harness on the `persistence/testing` subpath: an
// in-memory PGlite carrying the checked-in migrations, wrapped as the opaque
// `AppDatabase`, plus a `graphile_worker` STUB so `add_job` succeeds and
// enqueued jobs are assertable as rows. A caller that runs graphile's own
// migrations turns the stub off. `raw` is an unscoped SQL surface for TEST
// ASSERTIONS only, and production never sees this module.
import type { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { type AppDatabase, fromDrizzle } from "./db/handle";
import { createMigratedPglite } from "./pglite-snapshot";
import * as schema from "./schema/index";

// For consumers' vitest `globalSetup`: builds the migrated snapshot once,
// before workers fork, so a cold cache is paid sequentially instead of by
// every worker at once under coverage instrumentation.
export { warmPgliteSnapshot } from "./pglite-snapshot";

// Mirrors `job_key_mode` 'replace' and 'preserve_run_at'; parameter names match the
// named-notation call in `ingest.ts`. `key`, `run_at` and `locked_at` carry the
// real `graphile_worker.jobs` view's names, so a store read that passes here
// resolves in production. A NULL `key` never conflicts, so the keyless call is
// a plain insert. A key that matches a LOCKED job is detached from it first, so
// the insert adds a job beside the held one, as graphile's `add_jobs` does. Not
// mirrored: the detached job's `attempts = max_attempts`, and `payload`, which
// the real view lacks and this table carries for test assertions only.
const GRAPHILE_WORKER_STUB_SQL = `
create schema if not exists graphile_worker;
create table graphile_worker.jobs (
  id bigserial primary key, task_identifier text not null, payload json,
  key text unique, run_at timestamptz not null default now(), locked_at timestamptz,
  created_at timestamptz not null default now());
create or replace function graphile_worker.add_job(
  identifier text, payload json default null, job_key text default null,
  run_at timestamptz default now(), job_key_mode text default 'replace')
returns graphile_worker.jobs language sql as $$
  update graphile_worker.jobs set key = null
    where key = add_job.job_key and locked_at is not null;
  insert into graphile_worker.jobs(task_identifier, payload, key, run_at)
    values (add_job.identifier, add_job.payload, add_job.job_key, add_job.run_at)
  on conflict (key) do update
    set task_identifier = excluded.task_identifier,
        payload = excluded.payload,
        run_at = case when add_job.job_key_mode = 'preserve_run_at'
                      then graphile_worker.jobs.run_at else excluded.run_at end
  returning *;
$$;
`;

export interface PgliteHarness {
  /** Opaque handle: feed it to the tenant, ingest and purge factories. */
  readonly handle: AppDatabase;
  /** Unscoped raw query FOR TEST ASSERTIONS ONLY; returns the result rows. */
  raw(query: string, params?: unknown[]): Promise<Record<string, unknown>[]>;
  /**
   * The database itself, for a harness that must SERVE it to another process
   * over a socket. Nothing else should reach for it: `handle` is the API and
   * `raw` is the assertion window.
   */
  readonly database: PGlite;
  close(): Promise<void>;
}

export interface PgliteHarnessOptions {
  /**
   * Install the `graphile_worker` STUB schema. Default true. A caller that
   * SERVES this database to a process which runs graphile's own migrations
   * passes false, or the real migration collides with the stub's tables.
   */
  readonly graphileStub?: boolean;
}

/**
 * A migrated, isolated in-memory database (app schema + graphile_worker stub)
 * wrapped as the opaque `AppDatabase`, with a raw assertion window.
 */
export async function createPgliteHarness(
  options: PgliteHarnessOptions = {},
): Promise<PgliteHarness> {
  // Applied per instance rather than baked into the snapshot (~0ms next to the
  // ~120ms restore), keeping the snapshot the migrated app schema alone.
  const client = await createMigratedPglite();
  if (options.graphileStub !== false) {
    await client.exec(GRAPHILE_WORKER_STUB_SQL);
  }
  return {
    handle: fromDrizzle(drizzle(client, { schema })),
    database: client,
    async raw(query, params) {
      const result = await client.query<Record<string, unknown>>(query, params);
      return result.rows;
    },
    async close() {
      await client.close();
    },
  };
}
