// The `reconcile-webhook-deliveries` task: GitHub never retries a delivery the
// api could not take, so a restart or an outage loses it silently. Instance-wide,
// and the one scheduled job that calls GitHub. A failed tick waits for the next.
import {
  GitHubApiErrorCodes,
  type HookDelivery,
  type HookDeliveryPage,
} from "github";
import type { Logger } from "logging";
import type { Result } from "types/utils";
import { LOOK_BACK_MS, MAX_PAGES_PER_TICK } from "./consts";
import { selectRedeliveries } from "./logic/select-redeliveries";

interface GitHubFailure {
  readonly code: string;
  readonly status?: number;
}

const SPAM_STATUS = 422;

/** GitHub stopping this App ends the tick; one delivery's refusal does not. */
function isTickOver({ code, status }: GitHubFailure): boolean {
  const over =
    status === SPAM_STATUS || code === GitHubApiErrorCodes.RATE_LIMITED;
  return over;
}

export interface ReconcileWebhookDeliveriesTaskDeps {
  listDeliveries(
    cursor?: string,
  ): Promise<Result<HookDeliveryPage, GitHubFailure>>;
  redeliver(deliveryId: number): Promise<Result<void, GitHubFailure>>;
  readonly log: Logger;
  now(): Date;
}

/** Every attempt in the look-back; a failed page refuses the whole read. */
async function readRecentDeliveries(
  deps: ReconcileWebhookDeliveriesTaskDeps,
  now: Date,
): Promise<Result<readonly HookDelivery[], GitHubFailure>> {
  const oldest = now.getTime() - LOOK_BACK_MS;
  const deliveries: HookDelivery[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES_PER_TICK; page += 1) {
    // oxlint-disable-next-line no-await-in-loop -- each page names the next.
    const listed = await deps.listDeliveries(cursor);
    if (!listed.ok) {
      return listed;
    }
    const recent = listed.value.deliveries.filter(
      (delivery) => delivery.deliveredAt.getTime() >= oldest,
    );
    deliveries.push(...recent);
    const pastLookBack = recent.length < listed.value.deliveries.length;
    cursor = listed.value.nextCursor;
    const readAll = pastLookBack || cursor === undefined;
    if (readAll) {
      return { ok: true, value: deliveries };
    }
  }
  deps.log.warn(
    "webhook reconcile: more deliveries than one tick reads; older ones were not checked",
    { pages: MAX_PAGES_PER_TICK },
  );
  return { ok: true, value: deliveries };
}

/** Graphile's `Task` shape; the cron payload is unused. */
export function createReconcileWebhookDeliveriesTask(
  deps: ReconcileWebhookDeliveriesTaskDeps,
): () => Promise<void> {
  return async function reconcileDeliveries(): Promise<void> {
    const now = deps.now();
    const deliveries = await readRecentDeliveries(deps, now);
    if (!deliveries.ok) {
      deps.log.warn("webhook reconcile: GitHub did not list deliveries", {
        code: deliveries.error.code,
      });
      return;
    }

    let sent = 0;
    for (const delivery of selectRedeliveries(deliveries.value, now)) {
      // oxlint-disable-next-line no-await-in-loop -- one at a time: GitHub reads a burst as spam.
      const redelivered = await deps.redeliver(delivery.id);
      if (!redelivered.ok) {
        deps.log.warn("webhook reconcile: GitHub refused a redelivery", {
          code: redelivered.error.code,
        });
        if (isTickOver(redelivered.error)) {
          break;
        }
      } else {
        sent += 1;
      }
    }
    if (sent > 0) {
      deps.log.info(
        `webhook reconcile: asked GitHub to resend ${sent} deliveries`,
      );
    }
  };
}
