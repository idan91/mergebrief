import { describe, expect, it } from "vitest";
import { makeFixture } from "./helpers";

describe("makeFixture", () => {
  const SMALLEST_FIXTURE_ID = 1_000_000_000_000n;
  const LARGEST_SAFE_ID = BigInt(Number.MAX_SAFE_INTEGER);

  it("keeps the tenant id far above any real installation id", () => {
    const fixtures = Array.from({ length: 50 }, () => makeFixture());

    for (const fixture of fixtures) {
      expect(fixture.tenant).toBeGreaterThanOrEqual(SMALLEST_FIXTURE_ID);
      expect(fixture.tenant).toBeLessThanOrEqual(LARGEST_SAFE_ID);
      expect(fixture.repoId + 1n).toBeLessThanOrEqual(LARGEST_SAFE_ID);
      expect(fixture.ctx.installationId).toBe(fixture.tenant);
    }
  });
});
