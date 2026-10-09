import { IntentBuckets } from "brief-core/types";

/** Buckets that came after the intent check itself: older bodies lack them. */
const LATER_BUCKETS = [
  IntentBuckets.DEVIATIONS,
  IntentBuckets.CLAIMED_BUT_UNACHIEVED,
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fillAcknowledged(items: unknown): boolean {
  if (!Array.isArray(items)) {
    return false;
  }
  let filled = false;
  for (const item of items) {
    const lacksAcknowledged = isRecord(item) && !("acknowledged" in item);
    if (lacksAcknowledged) {
      item["acknowledged"] = false;
      filled = true;
    }
  }
  return filled;
}

/**
 * The intent check fields a body written before the alarm buckets lacks: the
 * two later buckets as empty lists and `acknowledged` as false. The current
 * reader drops the whole intent check without them. Undefined when the body
 * needs none of them.
 */
export function fillMissingIntentFields(body: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return undefined;
  }
  const intentCheck = isRecord(parsed) ? parsed["intentCheck"] : undefined;
  if (!isRecord(intentCheck)) {
    return undefined;
  }

  let filled = false;
  for (const bucket of LATER_BUCKETS) {
    if (!(bucket in intentCheck)) {
      intentCheck[bucket] = [];
      filled = true;
    }
  }
  for (const bucket of Object.values(IntentBuckets)) {
    filled = fillAcknowledged(intentCheck[bucket]) || filled;
  }

  return filled ? JSON.stringify(parsed) : undefined;
}
