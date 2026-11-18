import { describe, expect, it, vi } from "vitest";
import { makeFixture } from "./helpers";

describe("makeFixture", () => {
  const SMALLEST_FIXTURE_ID = 1_000_000_000_000n;
  const LARGEST_SAFE_ID = BigInt(Number.MAX_SAFE_INTEGER);

  it("gives two fixtures made in the same millisecond different ids", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);

    const first = makeFixture();
    const second = makeFixture();

    expect(second.tenant).not.toBe(first.tenant);
    expect(second.repoId).not.toBe(first.repoId);
  });

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
