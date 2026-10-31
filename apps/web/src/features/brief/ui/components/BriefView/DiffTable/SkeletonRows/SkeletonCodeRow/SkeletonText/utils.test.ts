import { describe, expect, it } from "vitest";

import { planWrapLines } from "./utils";

describe("planWrapLines", () => {
  it("draws no wrap for a line that fits", () => {
    expect(planWrapLines(40, 1, 63)).toEqual([]);
  });

  it("draws full lines, then the tail that is left", () => {
    expect(planWrapLines(140, 3, 63)).toEqual([
      { line: 1, columns: 63 },
      { line: 2, columns: 14 },
    ]);
  });

  it("draws no more lines than the row spans", () => {
    expect(planWrapLines(200, 2, 63)).toEqual([{ line: 1, columns: 63 }]);
  });

  it("draws the shorter side of a taller row on its own lines", () => {
    expect(planWrapLines(30, 3, 63)).toEqual([]);
  });
});
