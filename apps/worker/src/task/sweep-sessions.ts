// The `sweep-sessions` task: deletes expired `auth_session` rows and their
// orphaned grants on graphile's cron. Instance-wide, not ctx-bound: a session
// holds no installation. The api already refuses an expired session, so the
// sweep is housekeeping and always on.
import { sweepExpiredSessions, type AppDatabase } from "persistence";
import type { Logger } from "logging";

export const SWEEP_SESSIONS_TASK = "sweep-sessions";

/**
 * Hourly, off the hour and away from the audit sweep's minute. No backfill: a
 * worker down for a day sweeps once on return.
 */
export const SWEEP_SESSIONS_CRONTAB = `41 * * * * ${SWEEP_SESSIONS_TASK}`;

export interface SweepSessionsTaskDeps {
  readonly handle: AppDatabase;
  readonly log: Logger;
}

/** Graphile's `Task` shape; the cron payload is unused. */
export function createSweepSessionsTask(
  deps: SweepSessionsTaskDeps,
): () => Promise<void> {
  return async function sweepSessions(): Promise<void> {
    const deleted = await sweepExpiredSessions(deps.handle, new Date());

    if (deleted > 0) {
      deps.log.info(`sweep-sessions: deleted ${deleted} expired sessions`);
    }
  };
}
