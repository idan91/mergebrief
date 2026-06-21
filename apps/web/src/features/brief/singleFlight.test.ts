import { describe, expect, it } from "vitest";

import { createSingleFlight } from "./singleFlight";

describe("createSingleFlight", () => {
  it("collapses two concurrent calls for the same key into one underlying run", async () => {
    const singleFlight = createSingleFlight<number>();
    let runs = 0;
    const run = () =>
      singleFlight("k", async () => {
        runs++;
        return 42;
      });

    const [a, b] = await Promise.all([run(), run()]);

    expect(runs).toBe(1);
    expect(a).toBe(42);
    expect(b).toBe(42);
  });

  it("runs again for a new call after the in-flight one settles", async () => {
    const singleFlight = createSingleFlight<number>();
    let runs = 0;
    const run = () =>
      singleFlight("k", async () => {
        runs++;
        return runs;
      });

    expect(await run()).toBe(1);
    expect(await run()).toBe(2);
  });

  it("does not collapse calls under different keys", async () => {
    const singleFlight = createSingleFlight<string>();
    const results = await Promise.all([
      singleFlight("a", async () => "ran-a"),
      singleFlight("b", async () => "ran-b"),
    ]);

    expect(results).toEqual(["ran-a", "ran-b"]);
  });

  it("a rejection is not cached — a subsequent call for the same key tries again", async () => {
    const singleFlight = createSingleFlight<number>();
    let calls = 0;
    const run = () =>
      singleFlight("k", async () => {
        calls++;
        if (calls === 1) throw new Error("boom");
        return calls;
      });

    await expect(run()).rejects.toThrow("boom");
    expect(await run()).toBe(2);
  });
});
