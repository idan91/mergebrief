// Cross-package test harness on the `persistence/testing` subpath: an
// in-memory PGlite carrying the checked-in migrations, wrapped as the opaque
// `AppDatabase`, plus a `graphile_worker` STUB so `add_job` succeeds and
// enqueued jobs are assertable as rows. A caller that runs graphile's own
// migrations turns the stub off. `raw` is an unscoped SQL surface for TEST
// ASSERTIONS only, and production never sees this module.
import type { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import type { AnchorStatus } from "types/comments";
import { type AppDatabase, fromDrizzle, internal } from "../db/handle";
import { reviewDraftComment } from "../schema/review-draft-comment";
import type {
  GenerationProjection,
  GenerationRow,
  GenerationTarget,
} from "../stores/generation";
import { resolveScope } from "../stores/scope";
import type { ScopeContext } from "../stores/scope-context";
import {
  approvePullRequestTrigger,
  type PullRequestRow,
} from "../stores/tenant";
import {
  ClaimOutcomes,
  type GenerationFailure,
  type PullRequestRowId,
  type ReviewerId,
} from "../types";
import {
  GenerationPhases,
  GenerationStatuses,
  type GenerationPhase,
} from "types/generations";
import { createMigratedPglite } from "./pglite-snapshot";

// For consumers' vitest `globalSetup`: builds the migrated snapshot once,
// before workers fork, so a cold cache is paid sequentially instead of by
// every worker at once under coverage instrumentation.
export { warmPgliteSnapshot } from "./pglite-snapshot";
// One instance per test file: reset between tests instead of booting anew.
export { resetPgliteHarness } from "./pglite-reset";
// The suites PGlite cannot exercise, in this package, the api and the worker.
export { readTestPostgresUrl, type TestPostgresUrl } from "./postgres-url";
export {
  createFreshPostgresDatabase,
  type FreshPostgresDatabase,
} from "./fresh-database";
export { seedGrant, type SeedGrantInput } from "./seed-grant";
export {
  buildNamedPostgresUrl,
  terminateIdleTransactions,
  waitUntil,
} from "./terminate-backends";

// Mirrors `job_key_mode` 'replace' and 'preserve_run_at'; parameter names match
// the named-notation call in `ingest.ts`, and the columns carry the real
// `graphile_worker.jobs` view's names, so a store read that passes here
// resolves in production. A NULL `key` never conflicts. A key that matches a
// LOCKED job is detached from it first, so the insert adds a job beside the
// held one, as graphile's `add_jobs` does, and a replace resets `attempts`.
// Not mirrored: the detached job's `attempts = max_attempts`, and `payload`,
// which the real view lacks and this table carries for test assertions only.
const GRAPHILE_WORKER_STUB_SQL = `
create schema if not exists graphile_worker;
create table graphile_worker.jobs (
  id bigserial primary key, task_identifier text not null, payload json,
  key text unique, run_at timestamptz not null default now(), locked_at timestamptz,
  attempts int not null default 0, max_attempts int not null default 25,
  created_at timestamptz not null default now());
create or replace function graphile_worker.add_job(
  identifier text, payload json default null, job_key text default null,
  run_at timestamptz default now(), max_attempts int default null,
  job_key_mode text default 'replace')
returns graphile_worker.jobs language sql as $$
  update graphile_worker.jobs set key = null
    where key = add_job.job_key and locked_at is not null;
  insert into graphile_worker.jobs(task_identifier, payload, key, run_at, max_attempts)
    values (add_job.identifier, add_job.payload, add_job.job_key, add_job.run_at,
            coalesce(add_job.max_attempts, 25))
  on conflict (key) do update
    set task_identifier = excluded.task_identifier,
        payload = excluded.payload,
        max_attempts = excluded.max_attempts,
        attempts = 0,
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
    handle: fromDrizzle(drizzle(client)),
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

const TEST_LEASE_MS = 120_000;
const ANY_DAY = {
  from: new Date(0),
  to: new Date("2100-01-01T00:00:00.000Z"),
} as const;

export interface TestClaimOptions {
  readonly phase?: GenerationPhase;
  /** Zero leaves a claim whose lease has already lapsed. */
  readonly leaseMs?: number;
}

/** Claim the row as a worker run does and return the claim's run id. */
export async function claimTestRun(
  projection: GenerationProjection,
  target: GenerationTarget,
  options: TestClaimOptions = {},
): Promise<string> {
  const claimed = await projection.claimRun({
    target,
    phase: options.phase ?? GenerationPhases.FETCHING,
    leaseMs: options.leaseMs ?? TEST_LEASE_MS,
    ...ANY_DAY,
  });
  if (!claimed.ok) {
    throw new Error(claimed.error.message);
  }
  if (claimed.value.kind !== ClaimOutcomes.CLAIMED) {
    throw new Error(`test claim came back ${claimed.value.kind}`);
  }
  return claimed.value.runId;
}

/** Claim the row and finish it `succeeded`, as a successful run leaves it. */
export async function succeedTestRun(
  projection: GenerationProjection,
  target: GenerationTarget,
): Promise<GenerationRow> {
  const runId = await claimTestRun(projection, target);
  const finished = await projection.finishRun(target, runId, {
    status: GenerationStatuses.SUCCEEDED,
  });
  if (!finished.ok) {
    throw new Error(finished.error.message);
  }
  return finished.value;
}

/** Claim the row and finish it `failed` with `failure`, as a run that failed for good leaves it. */
export async function failTestRun(
  projection: GenerationProjection,
  target: GenerationTarget,
  failure: GenerationFailure,
): Promise<GenerationRow> {
  const runId = await claimTestRun(projection, target);
  const finished = await projection.finishRun(target, runId, {
    status: GenerationStatuses.FAILED,
    failure,
  });
  if (!finished.ok) {
    throw new Error(finished.error.message);
  }
  return finished.value;
}

/** Record a collaborator's Trigger approval through the write a Generate click runs. */
export async function approveTestTrigger(
  handle: AppDatabase,
  ctx: ScopeContext,
  pullRequestId: PullRequestRowId,
  reviewerId: ReviewerId,
): Promise<PullRequestRow | undefined> {
  return approvePullRequestTrigger(
    internal(handle),
    resolveScope(ctx),
    pullRequestId,
    reviewerId,
  );
}

/**
 * Stamp a carry-over verdict on a stored draft: the state a carried copy
 * holds and no reviewer action writes. Unscoped, for seeding only.
 */
export async function stampDraftAnchorStatus(
  handle: AppDatabase,
  draftId: bigint,
  anchorStatus: AnchorStatus,
): Promise<void> {
  await internal(handle)
    .update(reviewDraftComment)
    .set({ anchorStatus })
    .where(eq(reviewDraftComment.id, draftId));
}
