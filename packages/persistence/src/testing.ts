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
// named-notation call in `ingest.ts`. `language sql` (not plpgsql) because
// plpgsql raises 42702 on the bare `on conflict (job_key)` column list when a
// parameter shares the column's name; SQL functions resolve it to the COLUMN.
// A NULL `job_key` never conflicts, so the keyless call degrades to a plain
// insert.
const GRAPHILE_WORKER_STUB_SQL = `
create schema if not exists graphile_worker;
create table graphile_worker.jobs (
  id bigserial primary key, task_identifier text not null, payload json,
  job_key text unique, run_at timestamptz not null default now(), created_at timestamptz not null default now());
create or replace function graphile_worker.add_job(
  identifier text, payload json default null, job_key text default null,
  run_at timestamptz default now(), job_key_mode text default 'replace')
returns graphile_worker.jobs language sql as $$
  insert into graphile_worker.jobs(task_identifier, payload, job_key, run_at)
    values (add_job.identifier, add_job.payload, add_job.job_key, add_job.run_at)
  on conflict (job_key) do update
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
