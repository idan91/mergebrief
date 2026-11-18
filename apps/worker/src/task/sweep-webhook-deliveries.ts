// The `sweep-webhook-deliveries` task: deletes webhook deliveries past the
// dedup window on graphile's cron. Instance-wide, not ctx-bound: the seen-set
// holds no installation. Always on: a row past the window suppresses nothing.
import { sweepWebhookDeliveries, type AppDatabase } from "persistence";
import type { Logger } from "logging";

export const SWEEP_WEBHOOK_DELIVERIES_TASK = "sweep-webhook-deliveries";

/** Hourly, off the hour and away from the other sweeps' minutes. */
export const SWEEP_WEBHOOK_DELIVERIES_CRONTAB = `23 * * * * ${SWEEP_WEBHOOK_DELIVERIES_TASK}`;

export interface SweepWebhookDeliveriesTaskDeps {
  readonly handle: AppDatabase;
  readonly log: Logger;
}

/** Graphile's `Task` shape; the cron payload is unused. */
export function createSweepWebhookDeliveriesTask(
  deps: SweepWebhookDeliveriesTaskDeps,
): () => Promise<void> {
  return async function sweepDeliveries(): Promise<void> {
    const deleted = await sweepWebhookDeliveries(deps.handle, new Date());

    if (deleted > 0) {
      deps.log.info(
        `sweep-webhook-deliveries: deleted ${deleted} webhook deliveries past the dedup window`,
      );
    }
  };
}
