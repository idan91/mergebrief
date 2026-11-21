// The `reconcile-webhook-deliveries` task: GitHub never retries a delivery the
// api could not take, so a restart or an outage loses it silently. Instance-wide.
// A failed tick waits for the next.
import {
  GitHubApiErrorCodes,
  type HookDelivery,
  type HookDeliveryPage,
} from "github";
import type { Logger } from "logging";
import type { Result } from "types/utils";
import {
  LOOK_BACK_MS,
  MAX_FAILURE_PAGES_PER_TICK,
  MAX_PAGES_PER_TICK,
  REDELIVERY_WINDOW_MS,
} from "./consts";
import { isRecheckOnly, selectRedeliveries } from "./logic/select-redeliveries";

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
  listFailedDeliveries(
    cursor?: string,
  ): Promise<Result<HookDeliveryPage, GitHubFailure>>;
  redeliver(deliveryId: string): Promise<Result<void, GitHubFailure>>;
  readonly log: Logger;
  now(): Date;
}

/** What one tick read of the log. */
interface DeliveriesRead {
  readonly deliveries: readonly HookDelivery[];
  /** The oldest time the read reached, when the page cap stopped it short of the look-back. */
  readonly cutOffAt?: Date;
}

function readOldestTime(deliveries: readonly HookDelivery[], now: Date): Date {
  const times = deliveries.map((delivery) => delivery.deliveredAt.getTime());
  const oldestMs = Math.min(now.getTime(), ...times);
  return new Date(oldestMs);
}

/** Every attempt in the look-back; a failed page refuses the whole read. */
async function readRecentDeliveries(
  deps: ReconcileWebhookDeliveriesTaskDeps,
  now: Date,
): Promise<Result<DeliveriesRead, GitHubFailure>> {
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
      return { ok: true, value: { deliveries } };
    }
  }
  const cutOffAt = readOldestTime(deliveries, now);
  return { ok: true, value: { deliveries, cutOffAt } };
}

/**
 * The failures the capped read never reached that GitHub would still resend,
 * or `undefined` when they could not all be listed.
 */
async function readUnreadFailures(
  deps: ReconcileWebhookDeliveriesTaskDeps,
  cutOffAt: Date,
  now: Date,
): Promise<readonly HookDelivery[] | undefined> {
  const windowStart = now.getTime() - REDELIVERY_WINDOW_MS;
  const unread: HookDelivery[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_FAILURE_PAGES_PER_TICK; page += 1) {
    // oxlint-disable-next-line no-await-in-loop -- each page names the next.
    const listed = await deps.listFailedDeliveries(cursor);
    if (!listed.ok) {
      return undefined;
    }
    const inWindow = listed.value.deliveries.filter(
      (delivery) => delivery.deliveredAt.getTime() >= windowStart,
    );
    unread.push(
      ...inWindow.filter(
        (delivery) => delivery.deliveredAt.getTime() < cutOffAt.getTime(),
      ),
    );
    cursor = listed.value.nextCursor;
    const readAll =
      inWindow.length < listed.value.deliveries.length || cursor === undefined;
    if (readAll) {
      return unread;
    }
  }
  return undefined;
}

/**
 * Warns only when a delivery other than a check run or status may have gone
 * unread: those only wake a head to check it again, which its next report
 * wakes again.
 */
async function reportUnreadTail(
  deps: ReconcileWebhookDeliveriesTaskDeps,
  cutOffAt: Date,
  now: Date,
): Promise<void> {
  const unread = await readUnreadFailures(deps, cutOffAt, now);
  const actionable = unread?.filter((delivery) => !isRecheckOnly(delivery));
  if (actionable === undefined || actionable.length > 0) {
    deps.log.warn(
      "webhook reconcile: more deliveries than one tick reads; older failures were not checked",
      { pages: MAX_PAGES_PER_TICK, unreadFailures: actionable?.length },
    );
    return;
  }
  deps.log.info(
    "webhook reconcile: more deliveries than one tick reads; only status checks went unread",
    { pages: MAX_PAGES_PER_TICK },
  );
}

/** Graphile's `Task` shape; the cron payload is unused. */
export function createReconcileWebhookDeliveriesTask(
  deps: ReconcileWebhookDeliveriesTaskDeps,
): () => Promise<void> {
  return async function reconcileDeliveries(): Promise<void> {
    const now = deps.now();
    const read = await readRecentDeliveries(deps, now);
    if (!read.ok) {
      deps.log.warn("webhook reconcile: GitHub did not list deliveries", {
        code: read.error.code,
      });
      return;
    }
    if (read.value.cutOffAt !== undefined) {
      await reportUnreadTail(deps, read.value.cutOffAt, now);
    }

    let sent = 0;
    for (const delivery of selectRedeliveries(read.value.deliveries, now)) {
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
