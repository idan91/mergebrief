import { describe, expect, it } from "vitest";

import { deriveSpendReading, deriveTickFills, resolveCountKey } from "./utils";

const DAY_START = "2026-10-19T00:00:00.000Z";
const RESETS_AT = "2026-10-20T00:00:00.000Z";
const NOW = new Date("2026-10-19T18:00:00.000Z");

function stubView(startedRuns: number, cap?: number) {
  const view = { startedRuns, dayStartedAt: DAY_START, resetsAt: RESETS_AT };
  const shaped = cap === undefined ? view : { ...view, cap };
  return shaped;
}

describe("deriveSpendReading", () => {
  it.each([
    { name: "no cap as uncapped", view: stubView(37), level: "uncapped" },
    { name: "under 80% as clear", view: stubView(39, 50), level: "clear" },
    { name: "80% and over as near", view: stubView(40, 50), level: "near" },
    {
      name: "the whole cap as capped",
      view: stubView(50, 50),
      level: "capped",
    },
    { name: "past the cap as capped", view: stubView(53, 50), level: "capped" },
  ])("reads $name", ({ view, level }) => {
    expect(deriveSpendReading(view, NOW, "en", "UTC").level).toBe(level);
  });

  it("names the reset in the viewer's zone and in UTC", () => {
    const reading = deriveSpendReading(
      stubView(3, 50),
      NOW,
      "en",
      "Europe/Berlin",
    );

    expect(reading).toMatchObject({
      resetLocal: "02:00",
      resetUtc: "00:00",
      localIsUtc: false,
      readAtLocal: "20:00",
    });
  });

  it("says one time when the viewer's zone is UTC", () => {
    const reading = deriveSpendReading(stubView(3, 50), NOW, "en", "UTC");

    expect(reading.localIsUtc).toBe(true);
  });

  it("counts the reset down in hours", () => {
    const reading = deriveSpendReading(stubView(3, 50), NOW, "en", "UTC");

    expect(reading.resetRelative).toBe("in 6 hours");
  });

  it("counts the last hour down in minutes", () => {
    const lastHour = new Date("2026-10-19T23:35:00.000Z");

    const reading = deriveSpendReading(stubView(3, 50), lastHour, "en", "UTC");

    expect(reading.resetRelative).toBe("in 25 minutes");
  });

  it("never counts down past the reset", () => {
    const late = new Date("2026-10-20T00:00:30.000Z");

    const reading = deriveSpendReading(stubView(3, 50), late, "en", "UTC");

    expect(reading.resetRelative).toBe("in 1 minute");
  });
});

describe("resolveCountKey", () => {
  it.each([
    { startedRuns: 37, key: "spend.startedOfCap" },
    { startedRuns: 50, key: "spend.allUsed" },
    { startedRuns: 53, key: "spend.overCap" },
  ])("says $startedRuns of 50 with $key", ({ startedRuns, key }) => {
    expect(resolveCountKey(startedRuns, 50)).toBe(key);
  });
});

function countFilled(fills: readonly boolean[]): number {
  const filled = fills.filter(Boolean).length;
  return filled;
}

describe("deriveTickFills", () => {
  it("draws one tick per run up to fifty", () => {
    const fills = deriveTickFills(37, 50);

    expect(fills).toHaveLength(50);
    expect(countFilled(fills)).toBe(37);
  });

  it("draws a short strip for a small cap", () => {
    expect(deriveTickFills(2, 5)).toEqual([true, true, false, false, false]);
  });

  it("scales a cap past fifty onto fifty ticks", () => {
    const fills = deriveTickFills(99, 200);

    expect(fills).toHaveLength(50);
    expect(countFilled(fills)).toBe(24);
  });

  it("fills one tick for the first run of a large cap", () => {
    const filled = countFilled(deriveTickFills(1, 400));
    expect(filled).toBe(1);
  });

  it("fills every tick at the cap and past it", () => {
    const filled = countFilled(deriveTickFills(53, 50));
    expect(filled).toBe(50);
  });

  it.each([49, 50])(
    "fills exactly one tick per run under a cap of %i",
    (cap) => {
      for (let startedRuns = 0; startedRuns <= cap; startedRuns += 1) {
        const filled = countFilled(deriveTickFills(startedRuns, cap));
        expect(filled).toBe(startedRuns);
      }
    },
  );

  it("scales without dropping a run to float error", () => {
    const filled = countFilled(deriveTickFills(58, 100));
    expect(filled).toBe(29);
  });

  it("leaves the last tick empty one run short of a large cap", () => {
    const filled = countFilled(deriveTickFills(199, 200));
    expect(filled).toBe(49);
  });
});
