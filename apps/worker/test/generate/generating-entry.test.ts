// The large run's generating Entry estimate: one call alone, the rest across
// the detail lanes, rounded to five minutes and never under five.
import { describe, expect, it } from "vitest";
import { estimateMultiCallMinutes } from "../../src/task/generate/logic/generating-entry";

describe("estimateMultiCallMinutes", () => {
  it.each([
    [57, 8, 30],
    [2, 8, 10],
    [9, 8, 10],
    [20, 8, 15],
    [100, 1, 305],
  ])(
    "estimates %i calls over %i lanes as %i minutes",
    (calls, lanes, minutes) => {
      expect(estimateMultiCallMinutes(calls, lanes)).toBe(minutes);
    },
  );
});
