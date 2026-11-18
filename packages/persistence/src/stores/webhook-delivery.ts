// The webhook delivery seen-set, unscoped: it is read before any tenant write,
// and its key names no tenant row. The key is the verified signature's digest,
// so a changed delivery id header cannot slip a replay past it.
import { createHash } from "node:crypto";
import { and, eq, gt, lte } from "drizzle-orm";
import { traceStore } from "./trace-store";
import { type AppDatabase, internal } from "../db/handle";
import { webhookDelivery } from "../schema/webhook-delivery";
import {
  isWebhookSignatureDigest,
  type DeliveryId,
  type WebhookSignatureDigest,
} from "../types";

/** How long a recorded delivery suppresses its redelivery. */
export const DELIVERY_DEDUP_TTL_MS = 72 * 60 * 60 * 1000;

export interface WebhookDelivery {
  readonly signatureDigest: WebhookSignatureDigest;
  readonly deliveryId?: DeliveryId | undefined;
}

export interface WebhookDeliveryStore {
  /** A delivery with this digest was recorded within the dedup window before `now`. */
  hasRecentDelivery(
    signatureDigest: WebhookSignatureDigest,
    now: Date,
  ): Promise<boolean>;
  /** A digest already recorded keeps its first receipt time. */
  recordDelivery(delivery: WebhookDelivery, receivedAt: Date): Promise<void>;
}

function readWindowStart(now: Date): Date {
  return new Date(now.getTime() - DELIVERY_DEDUP_TTL_MS);
}

/** Hash the raw `X-Hub-Signature-256` value; call only after it verified. */
export function digestWebhookSignature(
  signature: string,
): WebhookSignatureDigest {
  const digest = createHash("sha256").update(signature).digest("hex");
  if (!isWebhookSignatureDigest(digest)) {
    throw new Error("sha256 digest failed its shape check");
  }
  return digest;
}

export function createWebhookDeliveryStore(
  handle: AppDatabase,
): WebhookDeliveryStore {
  const db = internal(handle);

  return traceStore("webhookDeliveries", {
    async hasRecentDelivery(signatureDigest, now) {
      const rows = await db
        .select({ signatureDigest: webhookDelivery.signatureDigest })
        .from(webhookDelivery)
        .where(
          and(
            eq(webhookDelivery.signatureDigest, signatureDigest),
            gt(webhookDelivery.receivedAt, readWindowStart(now)),
          ),
        )
        .limit(1);
      return rows.length > 0;
    },
    async recordDelivery(delivery, receivedAt) {
      await db
        .insert(webhookDelivery)
        .values({
          signatureDigest: delivery.signatureDigest,
          deliveryId: delivery.deliveryId ?? null,
          receivedAt,
        })
        .onConflictDoNothing({ target: webhookDelivery.signatureDigest });
    },
  });
}

/** Instance-wide: delete every delivery the seen-set no longer reads as recent. */
export async function sweepWebhookDeliveries(
  handle: AppDatabase,
  now: Date,
): Promise<number> {
  const deleted = await internal(handle)
    .delete(webhookDelivery)
    .where(lte(webhookDelivery.receivedAt, readWindowStart(now)))
    .returning({ signatureDigest: webhookDelivery.signatureDigest });
  return deleted.length;
}
