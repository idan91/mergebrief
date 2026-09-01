import type { TranslationKey } from "i18n";

import type { IntentCheck, IntentItem } from "../../../types";

/**
 * The preamble bullet's visible id — the last non-empty PATH segment of the
 * ticket URL (query/fragment never leak into it); a raw-split tail for
 * non-URL values, and the raw value when no tail exists.
 */
export function deriveTicketId(url: string): string {
  let source = url;
  try {
    source = new URL(url).pathname;
  } catch {
    // Not parseable as a URL — fall back to splitting the raw value.
  }
  const tail = source.split("/").findLast((segment) => segment !== "");
  return tail ?? url;
}

/**
 * Scheme allowlist for a model-produced URL before it becomes an href. A
 * non-http(s) value renders as plain text.
 */
export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** One bucket the split body renders: locale-free key, label, contents. */
export interface IntentBucketSpec {
  key: string;
  labelKey: TranslationKey;
  items: IntentItem[];
  /** Alarm-class: neutral glyph on the label + one caution line beneath. */
  alarm: boolean;
}

function hasItems(bucket: IntentBucketSpec): boolean {
  return bucket.items.length > 0;
}

/**
 * The split partition: left = nothing pending (accomplished + acknowledged
 * deviations), right = everything still needing the reader. Bucket order is
 * STATIC within each side — never model-ordered, never severity-sorted —
 * and the DOM must ship in this split order (the accessibility tree and
 * focus order depend on it). Empty buckets are omitted.
 */
export function partitionIntentCheck(intentCheck: IntentCheck): {
  checksOut: IntentBucketSpec[];
  needsALook: IntentBucketSpec[];
} {
  // Acknowledged deviations are quiet receipts, not alarms — partitioned
  // rather than sorted, because the halves carry different labels,
  // cautions, and weight.
  const unacknowledged = intentCheck.deviations.filter(
    (item) => !item.acknowledged,
  );
  const acknowledged = intentCheck.deviations.filter(
    (item) => item.acknowledged,
  );

  const checksOut: IntentBucketSpec[] = [
    {
      key: "accomplished",
      labelKey: "brief.intent.bucketAccomplished",
      items: intentCheck.accomplished,
      alarm: false,
    },
    {
      key: "acknowledgedDeviations",
      labelKey: "brief.intent.bucketAcknowledgedDeviations",
      items: acknowledged,
      alarm: false,
    },
  ];

  const needsALook: IntentBucketSpec[] = [
    {
      key: "claimedButUnachieved",
      labelKey: "brief.intent.bucketClaimedButUnachieved",
      items: intentCheck.claimedButUnachieved,
      alarm: true,
    },
    {
      key: "deviations",
      labelKey: "brief.intent.bucketDeviations",
      items: unacknowledged,
      alarm: true,
    },
    {
      key: "statedButMissing",
      labelKey: "brief.intent.bucketStatedButMissing",
      items: intentCheck.statedButMissing,
      alarm: false,
    },
    {
      key: "doneButUnstated",
      labelKey: "brief.intent.bucketDoneButUnstated",
      items: intentCheck.doneButUnstated,
      alarm: false,
    },
  ];

  return {
    checksOut: checksOut.filter(hasItems),
    needsALook: needsALook.filter(hasItems),
  };
}
