import type { HookDelivery } from "github";
import {
  ATTEMPT_WAITS_MS,
  MAX_REDELIVERIES_PER_TICK,
  REDELIVERY_WINDOW_MS,
} from "../consts";

/** The same body fails the same way: a malformed event, or one over the cap. */
const UNRETRYABLE_STATUSES: ReadonlySet<number> = new Set([400, 413]);
const SUCCESS_MIN = 200;
const SUCCESS_MAX = 299;

/** It deletes with no confirmation, so a replay would end a later sign-in. */
const NEVER_REPLAYED_EVENTS: ReadonlySet<string> = new Set([
  "github_app_authorization",
]);

/** A replay of one of these writes rows, so it must not outrun a removal. */
const ROW_WRITING_EVENTS: ReadonlySet<string> = new Set([
  "pull_request",
  "pull_request_review",
]);

function isSuccess({ statusCode }: HookDelivery): boolean {
  const succeeded = statusCode >= SUCCESS_MIN && statusCode <= SUCCESS_MAX;
  return succeeded;
}

function isUnretryable({ statusCode }: HookDelivery): boolean {
  return UNRETRYABLE_STATUSES.has(statusCode);
}

function isRemoval({ event, action }: HookDelivery): boolean {
  const uninstalled = event === "installation" && action === "deleted";
  const deselected =
    event === "installation_repositories" && action === "removed";
  const removes = uninstalled || deselected;
  return removes;
}

function compareOldestFirst(left: HookDelivery, right: HookDelivery): number {
  const gapMs = left.deliveredAt.getTime() - right.deliveredAt.getTime();
  return gapMs;
}

/**
 * Each installation's newest removal, whether or not the api took it, dated by
 * its earliest attempt in view: a retry's time says when GitHub resent it, not
 * when the removal happened, and a push after that removal must still go.
 */
function readLatestRemovals(
  attemptsByGuid: ReadonlyMap<string, readonly HookDelivery[]>,
): ReadonlyMap<number, number> {
  const latest = new Map<number, number>();
  for (const [first] of attemptsByGuid.values()) {
    if (first !== undefined && first.installationId !== undefined) {
      const seen = latest.get(first.installationId) ?? 0;
      const at = isRemoval(first) ? first.deliveredAt.getTime() : seen;
      latest.set(first.installationId, Math.max(seen, at));
    }
  }
  return latest;
}

function isOutrunByRemoval(
  { event, installationId, deliveredAt }: HookDelivery,
  removals: ReadonlyMap<number, number>,
): boolean {
  if (!ROW_WRITING_EVENTS.has(event) || installationId === undefined) {
    return false;
  }
  const removedAt = removals.get(installationId) ?? 0;
  const outrun = removedAt > deliveredAt.getTime();
  return outrun;
}

/**
 * `attempts` is oldest first. The first attempt when due, else `undefined`. A
 * guid whose first attempt is out of view has an unknown count, so it stays.
 */
function readDueOriginal(
  attempts: readonly HookDelivery[],
  removals: ReadonlyMap<number, number>,
  nowMs: number,
): HookDelivery | undefined {
  const original = attempts.find((attempt) => !attempt.redelivery);
  const latest = attempts.at(-1);
  const wait = ATTEMPT_WAITS_MS[attempts.length - 1];
  const unknownAttempts =
    original === undefined || latest === undefined || wait === undefined;
  if (unknownAttempts) {
    return undefined;
  }

  const settled = attempts.some(isSuccess) || attempts.some(isUnretryable);
  const held =
    NEVER_REPLAYED_EVENTS.has(original.event) ||
    isOutrunByRemoval(original, removals);
  if (settled || held) {
    return undefined;
  }

  const expired = nowMs - original.deliveredAt.getTime() > REDELIVERY_WINDOW_MS;
  const waiting = nowMs - latest.deliveredAt.getTime() < wait;
  return expired || waiting ? undefined : original;
}

/** The failed deliveries to resend now, oldest first. Takes no state beyond GitHub's log. */
export function selectRedeliveries(
  deliveries: readonly HookDelivery[],
  now: Date,
): readonly HookDelivery[] {
  const attemptsByGuid = new Map<string, HookDelivery[]>();
  for (const delivery of deliveries.toSorted(compareOldestFirst)) {
    const attempts = attemptsByGuid.get(delivery.guid) ?? [];
    attempts.push(delivery);
    attemptsByGuid.set(delivery.guid, attempts);
  }

  const removals = readLatestRemovals(attemptsByGuid);
  const nowMs = now.getTime();
  const due: HookDelivery[] = [];
  for (const attempts of attemptsByGuid.values()) {
    const original = readDueOriginal(attempts, removals, nowMs);
    if (original !== undefined) {
      due.push(original);
    }
  }
  return due.slice(0, MAX_REDELIVERIES_PER_TICK);
}
