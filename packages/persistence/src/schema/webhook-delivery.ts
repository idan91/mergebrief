// `webhook_delivery`, the seen-set a redelivered webhook is skipped against.
// Holds no installation: the check runs before any tenant write, and a
// signature names no tenant row. Swept past the dedup window.
import { check, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import {
  DELIVERY_ID_PATTERN,
  WEBHOOK_SIGNATURE_DIGEST_PATTERN,
  type DeliveryId,
  type WebhookSignatureDigest,
} from "../types";
import { matchesPattern } from "./checks";

export const webhookDelivery = pgTable(
  "webhook_delivery",
  {
    signatureDigest: text("signature_digest")
      .$type<WebhookSignatureDigest>()
      .primaryKey(),
    /** Log correlation only; the header is unsigned. */
    deliveryId: text("delivery_id").$type<DeliveryId>(),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("webhook_delivery_received_at_idx").on(table.receivedAt),
    check(
      "webhook_delivery_signature_digest_shape",
      matchesPattern(table.signatureDigest, WEBHOOK_SIGNATURE_DIGEST_PATTERN),
    ),
    check(
      "webhook_delivery_delivery_id_shape",
      sql`${table.deliveryId} is null or ${matchesPattern(table.deliveryId, DELIVERY_ID_PATTERN)}`,
    ),
  ],
);
