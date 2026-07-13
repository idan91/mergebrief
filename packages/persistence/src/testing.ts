// Cross-package test harness (BRIEF-2 stage 4) — exported via the dedicated
// `persistence/testing` subpath so consumer packages (`api`, later the worker)
// can integration-test against a real migrated schema without reaching this
// package's internals. Generalizes `test/helpers.ts`: a fresh in-memory PGlite,
// the checked-in `drizzle/` app migrations applied, wrapped as the opaque
// `AppDatabase` — plus a `graphile_worker` STUB so `add_job` calls succeed and
// enqueued jobs are assertable as rows.
//
// WHY A STUB: the real graphile-worker needs a real Postgres (LISTEN/NOTIFY,
// advisory locks) and cannot run on PGlite. The stub reproduces exactly the
// slice BRIEF-2 relies on: a `jobs` table and an `add_job(identifier, payload,
// job_key, run_at, job_key_mode)` function whose named parameters match our
// by-name call and whose `job_key` conflict behaves like graphile's
// `job_key_mode => 'replace'` (same key → payload/run_at replaced, one row).
// It stands in for real graphile ONLY in tests — the compose smoke (stage 5)
// runs the real graphile-worker migrations against real Postgres.
//
// `raw` intentionally exposes an unscoped SQL surface — for TEST ASSERTIONS
// only (counting rows across tenants, inspecting `graphile_worker.jobs`). It
// is the harness's escape hatch, not a query API; production code never sees
// this module (dev-only subpath, `@electric-sql/pglite` is a devDependency).
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { type AppDatabase, fromDrizzle } from "./db/handle";
import * as schema from "./schema/index";

const MIGRATIONS_FOLDER = fileURLToPath(new URL("../drizzle", import.meta.url));

// Faithful to the `job_key_mode => 'replace'` semantics BRIEF-2 relies on;
// parameter names match our named-notation call in `ingest.ts`. `language
// sql` (not plpgsql) because the parameter `job_key` must coexist with the
// column `job_key`: plpgsql raises 42702 (ambiguous reference) on the bare
// `on conflict (job_key)` column list, while SQL functions resolve an
// unqualified name that matches both to the COLUMN; parameter reads are
// function-name-qualified. One statement covers both paths — a NULL
// `job_key` never conflicts under the (nulls-distinct) unique index, so the
// keyless call degrades to a plain insert, exactly like the keyed branch of
// graphile's own implementation.
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
        run_at = excluded.run_at
  returning *;
$$;
`;

export interface PgliteHarness {
  /** Opaque handle — feed it to `forTenant`/`ingestRoutines`/`purgeRoutines`. */
  readonly handle: AppDatabase;
  /** Unscoped raw query FOR TEST ASSERTIONS ONLY; returns the result rows. */
  raw(query: string, params?: unknown[]): Promise<Record<string, unknown>[]>;
  close(): Promise<void>;
}

/**
 * A migrated, isolated in-memory database (app schema + graphile_worker stub)
 * wrapped as the opaque `AppDatabase`, with a raw assertion window.
 */
export async function createPgliteHarness(): Promise<PgliteHarness> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  await client.exec(GRAPHILE_WORKER_STUB_SQL);
  return {
    handle: fromDrizzle(db),
    async raw(query, params) {
      const result = await client.query<Record<string, unknown>>(query, params);
      return result.rows;
    },
    async close() {
      await client.close();
    },
  };
}
