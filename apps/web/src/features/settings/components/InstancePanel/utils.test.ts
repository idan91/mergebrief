import { describe, expect, it } from "vitest";

import {
  deriveMeterFillPercent,
  deriveSpendReading,
  resolveCountKey,
} from "./utils";

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

describe("deriveMeterFillPercent", () => {
  it("fills the share of the cap started", () => {
    expect(deriveMeterFillPercent(37, 50)).toBe(74);
  });

  it("leaves the track empty before the first run", () => {
    expect(deriveMeterFillPercent(0, 300)).toBe(0);
  });

  it("fills the track at the cap and past it", () => {
    expect(deriveMeterFillPercent(50, 50)).toBe(100);
    expect(deriveMeterFillPercent(53, 50)).toBe(100);
  });

  it("reads a zero cap as full", () => {
    expect(deriveMeterFillPercent(0, 0)).toBe(100);
  });
});
