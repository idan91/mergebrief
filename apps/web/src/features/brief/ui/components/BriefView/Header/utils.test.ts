import { describe, expect, it } from "vitest";

import {
  deriveCollapseShifts,
  deriveGhostPath,
  hasCollapseMovement,
  type CollapseLayout,
} from "./utils";

function makeLayout(overrides: Partial<CollapseLayout> = {}): CollapseLayout {
  return {
    barBottom: 126,
    comparisonTop: 81,
    identityCentre: 40,
    metaTop: 50,
    titleNeighbours: [{ x: 700, y: 12 }],
    title: { x: 120, y: 11 },
    titleFontPixels: 24,
    ...overrides,
  };
}

describe("deriveCollapseShifts", () => {
  const start = makeLayout();
  const end = makeLayout({
    barBottom: 111,
    comparisonTop: 66,
    identityCentre: 33,
    metaTop: 37,
    titleNeighbours: [{ x: 440, y: 9 }],
    title: { x: 120, y: 8 },
    titleFontPixels: 13,
  });

  it("starts the bar and comparison row where the old layout had them", () => {
    const shifts = deriveCollapseShifts(start, end);

    expect(shifts.bar).toBe(15);
    expect(shifts.comparison).toBe(15);
    expect(shifts.identity).toBe(7);
  });

  it("leaves the row's own offset out of the parts inside it", () => {
    const shifts = deriveCollapseShifts(start, end);

    expect(shifts.meta).toBe(6);
    expect(shifts.title).toEqual({ x: 0, y: -4 });
    expect(shifts.titleNeighbours).toEqual([{ x: 260, y: -4 }]);
  });

  it("scales the incoming title from the outgoing size", () => {
    expect(deriveCollapseShifts(start, end).titleScale).toBeCloseTo(24 / 13);
  });

  it("finds movement in a collapse", () => {
    expect(hasCollapseMovement(deriveCollapseShifts(start, end))).toBe(true);
  });

  it("finds none when both layouts match, as on a phone", () => {
    expect(hasCollapseMovement(deriveCollapseShifts(start, start))).toBe(false);
  });

  it("finds none when the title has no measured font size", () => {
    const unmeasured = makeLayout({ titleFontPixels: Number.NaN });

    expect(
      hasCollapseMovement(deriveCollapseShifts(unmeasured, unmeasured)),
    ).toBe(false);
  });
});

describe("deriveGhostPath", () => {
  const start = makeLayout();
  const end = makeLayout({
    identityCentre: 33,
    title: { x: 120, y: 8 },
    titleFontPixels: 13,
  });
  const ghostOrigin = { x: 100, y: 20 };

  it("starts the ghost where the outgoing title sat before the swap", () => {
    const shifts = deriveCollapseShifts(start, end);

    expect(deriveGhostPath({ start, end, ghostOrigin, shifts }).from).toEqual({
      x: 20,
      y: -16,
    });
  });

  it("ends the ghost on the incoming title at the incoming size", () => {
    const shifts = deriveCollapseShifts(start, end);
    const path = deriveGhostPath({ start, end, ghostOrigin, shifts });

    expect(path.to).toEqual({ x: 20, y: -12 });
    expect(path.endScale).toBeCloseTo(13 / 24);
  });
});
