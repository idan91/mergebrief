// The webhook delivery seen-set: keyed by the signature header's digest,
// unscoped, read within 72 hours and swept past them.
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  createWebhookDeliveryStore,
  DELIVERY_DEDUP_TTL_MS,
  digestWebhookSignature,
  sweepWebhookDeliveries,
} from "../src/stores/webhook-delivery";
import { isDeliveryId, WEBHOOK_SIGNATURE_DIGEST_PATTERN } from "../src/types";
import {
  brandWith,
  expectCheckViolation,
  registerSharedPglite,
} from "./helpers";

const shared = registerSharedPglite();

const RECEIVED_AT = new Date("2026-10-20T12:00:00Z");
const SIGNATURE = `sha256=${"a1".repeat(32)}`;
const OTHER_SIGNATURE = `sha256=${"b2".repeat(32)}`;
const DELIVERY_ID = brandWith(
  isDeliveryId,
  "72d3162e-cc78-11e3-81ab-4c9367dc0958",
);

function shiftTime(from: Date, ms: number): Date {
  return new Date(from.getTime() + ms);
}

async function countDeliveryRows(): Promise<number> {
  const result = await shared.db.execute(
    sql`select count(*)::int as count from webhook_delivery`,
  );
  return Number(result.rows[0]?.["count"]);
}

describe("webhook delivery store", () => {
  it("reads a recorded delivery as seen", async () => {
    const store = createWebhookDeliveryStore(shared.handle);
    const signatureDigest = digestWebhookSignature(SIGNATURE);

    await store.recordDelivery(
      { signatureDigest, deliveryId: DELIVERY_ID },
      RECEIVED_AT,
    );

    const otherDigest = digestWebhookSignature(OTHER_SIGNATURE);
    expect(await store.hasRecentDelivery(signatureDigest, RECEIVED_AT)).toBe(
      true,
    );
    expect(await store.hasRecentDelivery(otherDigest, RECEIVED_AT)).toBe(false);
  });

  it("records a delivery that carried no delivery id", async () => {
    const store = createWebhookDeliveryStore(shared.handle);
    const signatureDigest = digestWebhookSignature(SIGNATURE);

    await store.recordDelivery({ signatureDigest }, RECEIVED_AT);

    expect(await store.hasRecentDelivery(signatureDigest, RECEIVED_AT)).toBe(
      true,
    );
  });

  it("reads a delivery recorded 72 hours and 1 ms ago as unseen", async () => {
    const store = createWebhookDeliveryStore(shared.handle);
    const signatureDigest = digestWebhookSignature(SIGNATURE);
    await store.recordDelivery({ signatureDigest }, RECEIVED_AT);
    const justInside = shiftTime(RECEIVED_AT, DELIVERY_DEDUP_TTL_MS - 1);
    const justPast = shiftTime(RECEIVED_AT, DELIVERY_DEDUP_TTL_MS + 1);

    expect(await store.hasRecentDelivery(signatureDigest, justInside)).toBe(
      true,
    );
    expect(await store.hasRecentDelivery(signatureDigest, justPast)).toBe(
      false,
    );
  });

  it("keeps the first receipt time when a delivery is recorded twice", async () => {
    const store = createWebhookDeliveryStore(shared.handle);
    const signatureDigest = digestWebhookSignature(SIGNATURE);
    await store.recordDelivery({ signatureDigest }, RECEIVED_AT);

    await store.recordDelivery(
      { signatureDigest, deliveryId: DELIVERY_ID },
      shiftTime(RECEIVED_AT, DELIVERY_DEDUP_TTL_MS / 2),
    );

    const pastFirstWindow = shiftTime(RECEIVED_AT, DELIVERY_DEDUP_TTL_MS + 1);
    expect(
      await store.hasRecentDelivery(signatureDigest, pastFirstWindow),
    ).toBe(false);
  });

  it("digests one signature to one fixed-length lowercase hex key", () => {
    const signatureDigest = digestWebhookSignature(SIGNATURE);

    expect(signatureDigest).toMatch(WEBHOOK_SIGNATURE_DIGEST_PATTERN);
    expect(digestWebhookSignature(SIGNATURE)).toBe(signatureDigest);
    expect(digestWebhookSignature(OTHER_SIGNATURE)).not.toBe(signatureDigest);
  });
});

describe("webhook delivery sweep", () => {
  it("deletes only deliveries past 72 hours and returns the count", async () => {
    const store = createWebhookDeliveryStore(shared.handle);
    const now = shiftTime(RECEIVED_AT, DELIVERY_DEDUP_TTL_MS + 1);
    const recent = digestWebhookSignature(OTHER_SIGNATURE);
    await store.recordDelivery(
      { signatureDigest: digestWebhookSignature(SIGNATURE) },
      RECEIVED_AT,
    );
    await store.recordDelivery({ signatureDigest: recent }, now);

    const swept = await sweepWebhookDeliveries(shared.handle, now);

    expect(swept).toBe(1);
    expect(await countDeliveryRows()).toBe(1);
    expect(await store.hasRecentDelivery(recent, now)).toBe(true);
  });

  it("deletes nothing when every delivery is recent", async () => {
    const store = createWebhookDeliveryStore(shared.handle);
    await store.recordDelivery(
      { signatureDigest: digestWebhookSignature(SIGNATURE) },
      RECEIVED_AT,
    );

    expect(await sweepWebhookDeliveries(shared.handle, RECEIVED_AT)).toBe(0);
    expect(await countDeliveryRows()).toBe(1);
  });
});

describe("delivery id and digest shape", () => {
  it("accepts a GUID-shaped delivery id and refuses anything else", () => {
    expect(isDeliveryId("72d3162e-cc78-11e3-81ab-4c9367dc0958")).toBe(true);
    expect(isDeliveryId("a_B-9")).toBe(true);
    const overlongId = "x".repeat(65);
    expect(isDeliveryId("")).toBe(false);
    expect(isDeliveryId(overlongId)).toBe(false);
    expect(isDeliveryId("id\nforged=1")).toBe(false);
    expect(isDeliveryId("id with space")).toBe(false);
  });

  it("refuses a delivery id outside the shared pattern at the DB", async () => {
    const digest = "c3".repeat(32);
    await expectCheckViolation(
      shared.db.execute(
        sql`insert into webhook_delivery (signature_digest, delivery_id) values (${digest}, 'bad id')`,
      ),
      "webhook_delivery_delivery_id_shape",
    );
  });

  it("refuses a digest that is not lowercase SHA-256 hex at the DB", async () => {
    const uppercaseDigest = "C3".repeat(32);
    await expectCheckViolation(
      shared.db.execute(
        sql`insert into webhook_delivery (signature_digest) values (${uppercaseDigest})`,
      ),
      "webhook_delivery_signature_digest_shape",
    );
  });
});
