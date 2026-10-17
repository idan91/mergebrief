// The `sweep-pull-requests` task: pull request retention on graphile's cron.
// Instance-wide, not ctx-bound: retention is an operator env setting. Unset
// retention keeps everything; the task still runs and deletes nothing, so an
// upgrade never starts erasing an adopter's briefs on its own.
import { sweepClosedPullRequests, type AppDatabase } from "persistence";
import type { Logger } from "logging";

export const SWEEP_PULL_REQUESTS_TASK = "sweep-pull-requests";

/**
 * Daily, off the hour and away from the audit sweep's minute. No backfill: a
 * worker down for a week sweeps once on return, not seven times.
 */
export const SWEEP_PULL_REQUESTS_CRONTAB = `47 3 * * * ${SWEEP_PULL_REQUESTS_TASK}`;

export interface SweepPullRequestsTaskDeps {
  readonly handle: AppDatabase;
  /** `PR_RETENTION_DAYS`; null (the default) = keep forever. */
  readonly retentionDays: number | null;
  readonly log: Logger;
}

/** Graphile's `Task` shape; the cron payload is unused. */
export function createSweepPullRequestsTask(
  deps: SweepPullRequestsTaskDeps,
): () => Promise<void> {
  return async function sweepPullRequests(): Promise<void> {
    const deleted = await sweepClosedPullRequests(
      deps.handle,
      deps.retentionDays,
      new Date(),
    );

    if (deleted > 0) {
      deps.log.info(
        `sweep-pull-requests: deleted ${deleted} pull requests past retention`,
      );
    }
  };
}
