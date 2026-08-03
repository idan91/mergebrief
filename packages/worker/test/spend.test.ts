import { describe, expect, it } from "vitest";
import { utcDayBounds } from "../src/task/spend";

/**
 * The cap window (BRIEF-20). The boundary is the whole point: the day the
 * counter asks about must be half-open so 23:59:59.999 and 00:00:00.000
 * never land in the same bucket.
 */
describe("utcDayBounds", () => {
  it("brackets the UTC calendar day containing the instant", () => {
    const day = utcDayBounds(new Date("2026-08-03T13:45:12.345Z"));
    expect(day.from.toISOString()).toBe("2026-08-03T00:00:00.000Z");
    expect(day.to.toISOString()).toBe("2026-08-04T00:00:00.000Z");
    expect(day.label).toBe("2026-08-03");
  });

  it("puts midnight in the day it opens, not the one it closes", () => {
    const day = utcDayBounds(new Date("2026-08-03T00:00:00.000Z"));
    expect(day.from.toISOString()).toBe("2026-08-03T00:00:00.000Z");
    expect(day.label).toBe("2026-08-03");
  });

  it("puts the last millisecond in the day it ends", () => {
    const day = utcDayBounds(new Date("2026-08-03T23:59:59.999Z"));
    expect(day.label).toBe("2026-08-03");
    expect(day.to.toISOString()).toBe("2026-08-04T00:00:00.000Z");
  });

  it("rolls over month and year boundaries", () => {
    expect(
      utcDayBounds(new Date("2026-12-31T23:00:00.000Z")).to.toISOString(),
    ).toBe("2027-01-01T00:00:00.000Z");
  });
});
