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
    let inFlight = 0;
    let peak = 0;
    const finished: number[] = [];
    const delays = [40, 5, 5, 5, 5];
    await runInPool([0, 1, 2, 3, 4], 2, async (entry) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, delays[entry]));
      inFlight -= 1;
      finished.push(entry);
    });

    expect(peak).toBe(2);
    expect(finished.at(-1)).toBe(0);
    expect(finished).toHaveLength(5);
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
