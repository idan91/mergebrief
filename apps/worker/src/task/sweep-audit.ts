// The `sweep-audit` task — the system's FIRST scheduled job. Everything else
// here drains work a webhook enqueued; this one runs on graphile's cron.
//
// The sweep is INSTANCE-WIDE, not ctx-bound: retention is an env setting owned
// by whoever operates the instance, so there is no tenant to bind to — the one
// deletion in `persistence` that takes a bare handle rather than `createTenantRepository`.
//
// Unset retention keeps everything: the task still runs (and does nothing), so
// an upgrade never starts erasing an adopter's history on its own.
import { sweepAuditLog, type AppDatabase } from "persistence";
import type { Logger } from "logging";

/** The registered task name — the crontab line below names the same string. */
export const SWEEP_AUDIT_TASK = "sweep-audit";

/**
 * Daily, off the hour: nothing else is scheduled, and the odd minute keeps it
 * out of the crowd of external cron jobs that fire exactly at 03:00. No
 * backfill (graphile's default): a worker down for a week sweeps once on
 * return, not seven times.
 */
export const SWEEP_AUDIT_CRONTAB = `17 3 * * * ${SWEEP_AUDIT_TASK}`;

export interface SweepAuditTaskDeps {
  readonly handle: AppDatabase;
  /** `AUDIT_RETENTION_DAYS`; null (the default) = keep forever. */
  readonly retentionDays: number | null;
  readonly log: Logger;
}

/**
 * Build the audit-retention sweep task. The returned function is graphile's
 * `Task` shape (the cron payload is unused); tests call it directly.
 */
export function createSweepAuditTask(
  deps: SweepAuditTaskDeps,
): () => Promise<void> {
  return async function sweepAudit(): Promise<void> {
    const deleted = await sweepAuditLog(
      deps.handle,
      deps.retentionDays,
      new Date(),
    );
    if (deleted > 0) {
      deps.log.info(`sweep-audit: erased ${deleted} audit rows past retention`);
    }
  };
}
