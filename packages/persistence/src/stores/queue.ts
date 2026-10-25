// Every touch of graphile's queue this package makes: `graphile_worker.add_job`
// called BY NAME on the caller's transaction, and the one read of its job
// table (graphile owns its schema; this package never imports it). Ids cross as STRINGS, since JSON cannot carry
// bigint; the worker re-brands them through `TenantContextSchema`.
import { sql } from "drizzle-orm";
import { readActiveTraceparent } from "logging";
import type { AppDrizzle } from "../db/handle";
import type { GrantRowId, JobKeyMode } from "../types";
import type { RowScope } from "./scope";
import {
  QueueTasks,
  type GenerateJobPayload,
  type InstallationGenerateJobPayload,
  type JobTraceContext,
  type Mutable,
  type QueueTask,
  type UrlBoxGenerateJobPayload,
} from "types";

/**
 * Paid attempts per head, between triggers: graphile's retries of one job,
 * and the claims every job for the head makes on its row.
 */
export const MAX_GENERATION_ATTEMPTS = 3;

/**
 * The Entry sync's attempts: graphile waits exp(attempts) seconds between
 * them, so ten spread one GitHub outage over about three and a half hours.
 */
export const ENTRY_SYNC_MAX_ATTEMPTS = 10;

type QueueExecutor = Pick<AppDrizzle, "execute">;
type QueueReader = Pick<AppDrizzle, "select">;

export interface QueueJob {
  readonly identifier: QueueTask;
  readonly payload: GenerateJobPayload;
  readonly key: string;
  readonly delaySeconds: number;
  readonly keyMode: JobKeyMode;
  /** Defaults to `MAX_GENERATION_ATTEMPTS`. */
  readonly maxAttempts?: number;
}

/**
 * One pending recovery job per head. It wakes once a claimed run's lease could
 * have lapsed: a run's own job stays locked for hours after its worker dies.
 */
export function getRecoveryJobKey(
  pullRequestId: bigint,
  headSha: string,
): string {
  return `${QueueTasks.RECOVER_GENERATION}:${pullRequestId}:${headSha}`;
}

/** One pending Entry sync per head; a later queue moves it. */
export function getEntrySyncJobKey(
  pullRequestId: bigint,
  headSha: string,
): string {
  return `${QueueTasks.SYNC_ENTRY}:${pullRequestId}:${headSha}`;
}

/** The enqueue's trace, so the worker's job span can link back to it. */
function stampTraceparent<Payload extends JobTraceContext>(
  payload: Mutable<Payload>,
): Payload {
  const traceparent = readActiveTraceparent();
  if (traceparent !== undefined) {
    payload.traceparent = traceparent;
  }
  return payload;
}

/** The world-discriminated job payload. */
export function buildJobPayload(
  scope: RowScope,
  grantId: GrantRowId | undefined,
  pullRequestId: bigint,
  headSha: string,
): GenerateJobPayload {
  if (scope.ownerUserId !== null) {
    if (grantId === undefined) {
      // Programmer error: an owner-scoped job with no credential reference
      // is one the worker can only fail.
      throw new Error("an owner-scoped generate job requires grantId");
    }

    return stampTraceparent<UrlBoxGenerateJobPayload>({
      owner_user_id: String(scope.ownerUserId),
      grant_id: String(grantId),
      pull_request_id: String(pullRequestId),
      head_sha: headSha,
    });
  }

  if (scope.installationId === null) {
    throw new Error("scope carries neither world");
  }

  return stampTraceparent<InstallationGenerateJobPayload>({
    installation_id: String(scope.installationId),
    pull_request_id: String(pullRequestId),
    head_sha: headSha,
  });
}

/** Named notation, so extra defaulted parameters in real graphile don't matter. */
export async function addQueueJob(
  executor: QueueExecutor,
  job: QueueJob,
): Promise<void> {
  const payloadJson = JSON.stringify(job.payload);
  await executor.execute(sql`
    select graphile_worker.add_job(
      ${job.identifier},
      payload => ${payloadJson}::json,
      job_key => ${job.key},
      run_at => now() + make_interval(secs => ${job.delaySeconds}),
      max_attempts => ${job.maxAttempts ?? MAX_GENERATION_ATTEMPTS},
      job_key_mode => ${job.keyMode}
    )
  `);
}

/** Where one keyed job stands, judged by the database clock. */
export interface QueueJobState {
  readonly locked: boolean;
  readonly startsLater: boolean;
  /** False once graphile spent the attempts: the job stays, unlocked, and never runs. */
  readonly hasAttemptsLeft: boolean;
  readonly runAt: Date;
}

/** The one read of graphile's job table; `undefined` when no job holds the key. */
export async function readQueueJob(
  reader: QueueReader,
  jobKey: string,
): Promise<QueueJobState | undefined> {
  const rows = await reader
    .select({
      locked: sql<boolean>`job.locked_at is not null`,
      startsLater: sql<boolean>`job.run_at > now()`,
      hasAttemptsLeft: sql<boolean>`job.attempts < job.max_attempts`,
      runAt: sql<Date>`job.run_at`.mapWith(
        (value: Date | string) => new Date(value),
      ),
    })
    .from(sql`graphile_worker.jobs as job`)
    .where(sql`job.key = ${jobKey}`)
    .limit(1);
  return rows[0];
}
