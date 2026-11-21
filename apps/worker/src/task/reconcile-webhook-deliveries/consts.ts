const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

export const RECONCILE_WEBHOOK_DELIVERIES_TASK = "reconcile-webhook-deliveries";

/** Every 15 minutes, away from the sweeps' minutes. */
export const RECONCILE_WEBHOOK_DELIVERIES_CRONTAB = `7,22,37,52 * * * * ${RECONCILE_WEBHOOK_DELIVERIES_TASK}`;

/** How far back a tick reads. Stateless: the worker is down in the outages that matter. */
export const LOOK_BACK_MS = 72 * HOUR_MS;

/** GitHub refuses a redelivery past three days, so stop short of it. */
export const REDELIVERY_WINDOW_MS = 71 * HOUR_MS;

/** The wait after attempt N, so an api down for hours does not spend them all. */
export const ATTEMPT_WAITS_MS: readonly number[] = [
  15 * MINUTE_MS,
  HOUR_MS,
  4 * HOUR_MS,
  12 * HOUR_MS,
];

export const MAX_REDELIVERIES_PER_TICK = 20;
/**
 * Check run and status deliveries fill the App's log by the dozen per push.
 * Each page is one App JWT request: at most 400 an hour at a tick every 15
 * minutes. A failure older than the last page read is never seen.
 */
export const MAX_PAGES_PER_TICK = 100;

/** The failed-only pages read past that cap, to tell what went unread. */
export const MAX_FAILURE_PAGES_PER_TICK = 10;
