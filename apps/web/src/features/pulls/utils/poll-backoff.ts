import { HttpStatuses } from "types/http";

import { ApiError, isSignInRequired } from "../../../data/apiFetch";
import { OUTAGE_BACKOFF_FACTOR, OUTAGE_POLL_MAX_MS } from "../consts";

/** The slice of a query's state the backoff reads. */
export interface PollRead {
  readonly error: unknown;
  readonly dataUpdatedAt: number;
  readonly errorUpdatedAt: number;
}

const OUTAGE_STATUSES: ReadonlySet<number> = new Set([
  HttpStatuses.BAD_GATEWAY,
  HttpStatuses.SERVICE_UNAVAILABLE,
  HttpStatuses.GATEWAY_TIMEOUT,
]);

function isOutage(error: unknown): boolean {
  return error instanceof ApiError && OUTAGE_STATUSES.has(error.status);
}

function isSignedOutRead(error: unknown): boolean {
  return error instanceof ApiError && isSignInRequired(error.code);
}

/**
 * The next poll delay. After an outage answer it waits the longer of twice
 * `healthyMs` and the time since the last success, capped; the first read
 * that succeeds clears `error` and restores `healthyMs`. A read that needs
 * sign-in stops the poll: no later answer can differ until the viewer acts.
 */
export function resolveOutagePollMs(
  read: PollRead,
  healthyMs: number | false,
): number | false {
  if (isSignedOutRead(read.error)) {
    return false;
  }
  const keepsHealthyCadence = healthyMs === false || !isOutage(read.error);
  if (keepsHealthyCadence) {
    return healthyMs;
  }

  const outageMs =
    read.dataUpdatedAt === 0 ? 0 : read.errorUpdatedAt - read.dataUpdatedAt;
  const backedOffMs = Math.max(healthyMs * OUTAGE_BACKOFF_FACTOR, outageMs);
  return Math.min(backedOffMs, OUTAGE_POLL_MAX_MS);
}
