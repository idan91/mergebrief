// The scheduled webhook delivery sweep against a real migrated schema (the
// `persistence/testing` PGlite harness). Rows are seeded through the
// persistence store the api records with.
import { describe, expect, it } from "vitest";
import {
  createWebhookDeliveryStore,
  DELIVERY_DEDUP_TTL_MS,
  digestWebhookSignature,
} from "persistence";
import { createSweepWebhookDeliveriesTask } from "../src/task/sweep-webhook-deliveries";
import { captureLogger } from "./generate/helpers";
import { registerSharedPglite, type SharedPglite } from "./shared-pglite";

const HOUR_MS = 60 * 60 * 1000;

async function seedDelivery(
  harness: SharedPglite,
  signature: string,
  receivedAt: Date,
): Promise<void> {
  await createWebhookDeliveryStore(harness.handle).recordDelivery(
    { signatureDigest: digestWebhookSignature(signature) },
    receivedAt,
  );
}

async function countDeliveries(harness: SharedPglite): Promise<unknown> {
  const rows = await harness.raw(
    "select count(*)::int as n from webhook_delivery",
  );
  return rows[0]?.["n"];
}

describe("sweep-webhook-deliveries task", () => {
  const harness = registerSharedPglite();

  it("deletes deliveries past the window and logs the count", async () => {
    const { logger, readLines } = captureLogger();
    await seedDelivery(
      harness,
      "sha256=old",
      new Date(Date.now() - DELIVERY_DEDUP_TTL_MS - HOUR_MS),
    );
    await seedDelivery(harness, "sha256=recent", new Date());

    await createSweepWebhookDeliveriesTask({
      handle: harness.handle,
      log: logger,
    })();

    expect(await countDeliveries(harness)).toBe(1);
    expect(readLines()).toEqual([
      expect.objectContaining({
        level: "info",
        msg: "sweep-webhook-deliveries: deleted 1 webhook deliveries past the dedup window",
      }),
    ]);
  });

  it("logs nothing when no delivery is past the window", async () => {
    const { logger, readLines } = captureLogger();
    await seedDelivery(harness, "sha256=recent", new Date());

    await createSweepWebhookDeliveriesTask({
      handle: harness.handle,
      log: logger,
    })();

    expect(await countDeliveries(harness)).toBe(1);
    expect(readLines()).toEqual([]);
  });
});
