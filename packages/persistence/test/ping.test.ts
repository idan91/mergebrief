// pingDb (BRIEF-51, ADR 0034 #7): the /readyz probe's `SELECT 1` — true on a
// reachable database, false (never a throw) when the round-trip fails.
import { describe, expect, it } from "vitest";
import { pingDb } from "../src/lib";
import { createPgliteHarness } from "../src/testing";

describe("pingDb", () => {
  it("returns true against a live database", async () => {
    const harness = await createPgliteHarness();
    try {
      await expect(pingDb(harness.handle)).resolves.toBe(true);
    } finally {
      await harness.close();
    }
  });

  it("returns false, without throwing, once the database is gone", async () => {
    const harness = await createPgliteHarness();
    await harness.close();
    await expect(pingDb(harness.handle)).resolves.toBe(false);
  });
});
