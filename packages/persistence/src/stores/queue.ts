// The graphile queue writes this package makes: `graphile_worker.add_job`
// called BY NAME on the caller's transaction (graphile owns its schema; this
// package never imports it). Ids cross as STRINGS, since JSON cannot carry
// bigint; the worker re-brands them through `TenantContextSchema`.
import { sql } from "drizzle-orm";
import type { AppDrizzle } from "../db/handle";
import type { GrantRowId, JobKeyMode } from "../types";
import type { RowScope } from "./scope";
import type { GenerateJobPayload } from "types";

export const GENERATE_TASK_IDENTIFIER = "generate";

/**
 * The job that wakes once a claimed run's lease could have lapsed: a run's
 * own job stays locked for hours after its worker dies.
 */
export const RECOVER_GENERATION_TASK = "recover-generation";

/**
 * Paid attempts per head, between triggers: graphile's retries of one job,
 * and the claims every job for the head makes on its row.
 */
export const MAX_GENERATION_ATTEMPTS = 3;

type QueueExecutor = Pick<AppDrizzle, "execute">;

export interface QueueJob {
  readonly identifier: string;
  readonly payload: GenerateJobPayload;
  readonly key: string;
  readonly delaySeconds: number;
  readonly keyMode: JobKeyMode;
}

/** One pending recovery job per head. */
export function getRecoveryJobKey(
  pullRequestId: bigint,
  headSha: string,
): string {
  return `${RECOVER_GENERATION_TASK}:${pullRequestId}:${headSha}`;
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

    return {
      owner_user_id: String(scope.ownerUserId),
      grant_id: String(grantId),
      pull_request_id: String(pullRequestId),
      head_sha: headSha,
    } satisfies GenerateJobPayload;
  }

  if (scope.installationId === null) {
    throw new Error("scope carries neither world");
  }

  return {
    installation_id: String(scope.installationId),
    pull_request_id: String(pullRequestId),
    head_sha: headSha,
  } satisfies GenerateJobPayload;
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
      max_attempts => ${MAX_GENERATION_ATTEMPTS},
      job_key_mode => ${job.keyMode}
    )
  `);
}
