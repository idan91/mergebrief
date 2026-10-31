import { afterEach, describe, expect, it, vi } from "vitest";

import {
  alignShine,
  countLineDigits,
  resolveShineDelay,
  SHINE_CYCLE_MS,
} from "./utils";

describe("resolveShineDelay", () => {
  it("steps a later sweep to the phase the first one has reached", () => {
    expect(resolveShineDelay(SHINE_CYCLE_MS * 3 + 250, 0)).toBe(-250);
    expect(resolveShineDelay(900, 400)).toBe(-500);
  });

  it("keeps the phase in one cycle when the sweep starts first", () => {
    expect(resolveShineDelay(300, 400)).toBe(-(SHINE_CYCLE_MS - 100));
  });
});

describe("alignShine", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function stubShine(written: Map<string, string>): HTMLElement {
    return {
      style: {
        setProperty: (name: string, value: string) => written.set(name, value),
      },
    } as unknown as HTMLElement;
  }

  it("aligns to the first paint, when the rendered sweeps started", () => {
    vi.spyOn(performance, "getEntriesByName").mockReturnValue([
      { startTime: 400 } as PerformanceEntry,
    ]);
    const written = new Map<string, string>();

    alignShine(stubShine(written), 900);

    expect(written.get("--shine-delay")).toBe("-500ms");
  });

  it("aligns to the clock's origin before any paint is recorded", () => {
    vi.spyOn(performance, "getEntriesByName").mockReturnValue([]);
    const written = new Map<string, string>();

    alignShine(stubShine(written), SHINE_CYCLE_MS + 250);

    expect(written.get("--shine-delay")).toBe("-250ms");
  });
});

describe("countLineDigits", () => {
  it("counts the digits of the last line the slice reaches", () => {
    const ranges = {
      addedRanges: [{ start: 990, end: 998 }],
      removedRanges: [{ start: 12, end: 14 }],
    };

    expect(countLineDigits(ranges)).toBe(4);
  });

  it("draws two digits at the least", () => {
    expect(countLineDigits({ addedRanges: [], removedRanges: [] })).toBe(2);
  });
});
