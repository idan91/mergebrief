import { describe, expect, it } from "vitest";
import { runInBatches, runInPool } from "./batches";

describe("runInBatches", () => {
  it("runs at most width entries at once and keeps the order", async () => {
    let inFlight = 0;
    let peak = 0;
    const outcomes = await runInBatches([1, 2, 3, 4, 5], 2, async (entry) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return entry * 10;
    });

    expect(outcomes).toEqual([10, 20, 30, 40, 50]);
    expect(peak).toBe(2);
  });

  it("stops after the batch that holds a stopping outcome", async () => {
    const started: number[] = [];
    const outcomes = await runInBatches(
      [1, 2, 3, 4, 5],
      2,
      async (entry) => {
        started.push(entry);
        return entry;
      },
      (outcome) => outcome === 3,
    );

    expect(outcomes).toEqual([1, 2, 3, 4]);
    expect(started).toEqual([1, 2, 3, 4]);
  });
});

describe("runInPool", () => {
  it("keeps at most width in flight and refills a slot as soon as one frees", async () => {
    const width = 2;
    const entries = [0, 1, 2, 3, 4];
    const slowEntryId = 0;
    const fastEntryCount = entries.length - 1;
    let inFlight = 0;
    let peak = 0;
    const finished: number[] = [];
    const slowEntry = Promise.withResolvers<void>();
    await runInPool(entries, width, async (entry) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      if (entry === slowEntryId) {
        await slowEntry.promise;
      } else {
        await Promise.resolve();
      }
      inFlight -= 1;
      finished.push(entry);
      if (finished.length === fastEntryCount) {
        slowEntry.resolve();
      }
    });

    expect(peak).toBe(width);
    expect(finished.at(-1)).toBe(slowEntryId);
    expect(finished).toHaveLength(entries.length);
  });

  it("runs every entry even at a width below one", async () => {
    const seen: number[] = [];
    await runInPool([1, 2, 3], 0, async (entry) => {
      seen.push(entry);
      await Promise.resolve();
    });

    expect(seen).toEqual([1, 2, 3]);
  });
});
