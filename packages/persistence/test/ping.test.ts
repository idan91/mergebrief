import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pingDb } from "../src/index";
import { createPgliteHarness, type PgliteHarness } from "../src/testing";

describe("pingDb", () => {
  let harness: PgliteHarness | undefined;

  function readHarness(): PgliteHarness {
    if (harness === undefined) {
      throw new Error("the ping harness opens before the first test");
    }
    return harness;
  }

  beforeAll(async () => {
    harness = await createPgliteHarness();
  });
  afterAll(async () => {
    if (harness !== undefined && !harness.database.closed) {
      await harness.close();
    }
  });

  it("returns true against a live database", async () => {
    await expect(pingDb(readHarness().handle)).resolves.toBe(true);
  });

  it("returns false, without throwing, once the database is gone", async () => {
    const closing = readHarness();
    await closing.close();
    await expect(pingDb(closing.handle)).resolves.toBe(false);
  });
});
