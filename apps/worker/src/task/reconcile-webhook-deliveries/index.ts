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
const CONNECTION_FAILURE_STATUS = 0;

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

/** The failed-only read; not listed when a page failed or the page cap ran out. */
type UnreadFailuresRead =
  | { readonly listed: true; readonly deliveries: readonly HookDelivery[] }
  | { readonly listed: false };

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

/** The failures the capped read never reached that GitHub would still resend. */
async function readUnreadFailures(
  deps: ReconcileWebhookDeliveriesTaskDeps,
  cutOffAt: Date,
  now: Date,
): Promise<UnreadFailuresRead> {
  const windowStart = now.getTime() - REDELIVERY_WINDOW_MS;
  const unread: HookDelivery[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_FAILURE_PAGES_PER_TICK; page += 1) {
    // oxlint-disable-next-line no-await-in-loop -- each page names the next.
    const listed = await deps.listFailedDeliveries(cursor);
    if (!listed.ok) {
      return { listed: false };
    }
    const inWindow = listed.value.deliveries.filter(
      (delivery) => delivery.deliveredAt.getTime() >= windowStart,
    );
    const beforeCutOff = inWindow.filter(
      (delivery) => delivery.deliveredAt.getTime() < cutOffAt.getTime(),
    );
    unread.push(...beforeCutOff);
    cursor = listed.value.nextCursor;
    const readAll =
      inWindow.length < listed.value.deliveries.length || cursor === undefined;
    if (readAll) {
      return { listed: true, deliveries: unread };
    }
  }
  return { listed: false };
}

interface UnreadTailCounts {
  readonly unreadFailures?: number;
  readonly connectionFailures: number;
}

function warnUnreadTail(log: Logger, counts: UnreadTailCounts): void {
  log.warn(
    "webhook reconcile: more deliveries than one tick reads; older failures were not checked",
    { pages: MAX_PAGES_PER_TICK, ...counts },
  );
}

/**
 * Stays below warn only when every unread 4xx or 5xx failure is a check run
 * or status, which only wakes a head its next report wakes again, and the
 * pages read hold no never-connected attempt: an older one past the cut-off
 * would be out of sight.
 */
async function reportUnreadTail(
  deps: ReconcileWebhookDeliveriesTaskDeps,
  read: Required<DeliveriesRead>,
  now: Date,
): Promise<void> {
  const unread = await readUnreadFailures(deps, read.cutOffAt, now);
  const connectionFailures = read.deliveries.filter(
    (delivery) => delivery.statusCode === CONNECTION_FAILURE_STATUS,
  ).length;
  if (!unread.listed) {
    warnUnreadTail(deps.log, { connectionFailures });
    return;
  }

  const actionable = unread.deliveries.filter(
    (delivery) => !isRecheckOnly(delivery),
  );
  const actionableMayBeUnread = actionable.length > 0 || connectionFailures > 0;
  if (actionableMayBeUnread) {
    warnUnreadTail(deps.log, {
      unreadFailures: actionable.length,
      connectionFailures,
    });
    return;
  }
  deps.log.info(
    "webhook reconcile: more deliveries than one tick reads; no 4xx/5xx failure outside check runs and statuses went unread",
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
    const { deliveries, cutOffAt } = read.value;
    if (cutOffAt !== undefined) {
      await reportUnreadTail(deps, { deliveries, cutOffAt }, now);
    }

    let sent = 0;
    for (const delivery of selectRedeliveries(deliveries, now)) {
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
