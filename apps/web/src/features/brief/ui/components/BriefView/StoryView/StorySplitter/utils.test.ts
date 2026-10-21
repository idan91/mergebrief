import { describe, expect, it, vi } from "vitest";

import {
  deriveCardCeiling,
  deriveTrackFromPointer,
  hasMovedPastSlop,
  isSameMeasure,
  readEntryWidth,
  readServerStacked,
  releaseCapture,
  resolveStackedQuery,
  restoreTrack,
  stepTrack,
} from "./utils";
import type { StoryDrag } from "./types";
import { StackedQueries } from "./types";

describe("deriveTrackFromPointer", () => {
  it("widens the card as the pointer moves toward the start edge", () => {
    expect(deriveTrackFromPointer(450, 1000, 940, "ltr")).toBe(510);
  });

  it("narrows the card as the pointer moves toward the end edge", () => {
    expect(deriveTrackFromPointer(450, 1000, 1030, "ltr")).toBe(420);
  });

  it("mirrors the axis under rtl", () => {
    expect(deriveTrackFromPointer(450, 1000, 940, "rtl")).toBe(390);
  });
});

describe("stepTrack", () => {
  const bounds = { step: 16, floor: 360, ceiling: 750 };

  it("ArrowLeft widens the card by one step", () => {
    expect(stepTrack(450, "ArrowLeft", "ltr", bounds)).toBe(466);
  });

  it("ArrowRight narrows the card by one step", () => {
    expect(stepTrack(450, "ArrowRight", "ltr", bounds)).toBe(434);
  });

  it("ArrowLeft narrows the card under rtl", () => {
    expect(stepTrack(450, "ArrowLeft", "rtl", bounds)).toBe(434);
  });

  it("Home lands on the floor", () => {
    expect(stepTrack(450, "Home", "ltr", bounds)).toBe(360);
  });

  it("End lands on the ceiling", () => {
    expect(stepTrack(450, "End", "ltr", bounds)).toBe(750);
  });

  it("a step never leaves the bounds", () => {
    expect(stepTrack(745, "ArrowLeft", "ltr", bounds)).toBe(750);
    expect(stepTrack(365, "ArrowRight", "ltr", bounds)).toBe(360);
  });

  it("ignores keys the separator does not own", () => {
    expect(stepTrack(450, "Enter", "ltr", bounds)).toBeUndefined();
  });
});

describe("deriveCardCeiling", () => {
  it("is the fixed ceiling on a wide column", () => {
    expect(deriveCardCeiling(1600, 18)).toBe(750);
  });

  it("leaves the diff its floor, headroom and the gap when narrow", () => {
    expect(deriveCardCeiling(1100, 18)).toBe(580);
  });

  it("never drops under the floor", () => {
    expect(deriveCardCeiling(700, 18)).toBe(360);
  });
});

describe("resolveStackedQuery", () => {
  it("keys on the sidebar layout", () => {
    expect(resolveStackedQuery(undefined)).toBe(StackedQueries.BARE);
    expect(resolveStackedQuery("bar")).toBe(StackedQueries.BARE);
    expect(resolveStackedQuery("collapsed")).toBe(
      StackedQueries.SIDEBAR_COLLAPSED,
    );
    expect(resolveStackedQuery("expanded")).toBe(
      StackedQueries.SIDEBAR_EXPANDED,
    );
  });
});

function stubEntry(
  borderBox: number | undefined,
  content: number,
): ResizeObserverEntry {
  return {
    borderBoxSize: borderBox === undefined ? [] : [{ inlineSize: borderBox }],
    contentRect: { width: content },
  } as unknown as ResizeObserverEntry;
}

describe("readEntryWidth", () => {
  it("prefers the border box", () => {
    expect(readEntryWidth(stubEntry(450.4, 448))).toBe(450);
  });

  it("falls back to the content rect", () => {
    expect(readEntryWidth(stubEntry(undefined, 448))).toBe(448);
  });
});

describe("isSameMeasure", () => {
  it("compares all three widths", () => {
    const base = { column: 1400, chunks: 932, card: 450 };
    expect(isSameMeasure(base, { ...base })).toBe(true);
    expect(isSameMeasure(base, { ...base, chunks: 900 })).toBe(false);
  });
});

describe("hasMovedPastSlop", () => {
  const drag = { startX: 100, moved: false } as StoryDrag;

  it("needs the slop before a press counts as a drag", () => {
    expect(hasMovedPastSlop(drag, 101, 2)).toBe(false);
    expect(hasMovedPastSlop(drag, 98, 2)).toBe(true);
  });

  it("stays armed once it has moved", () => {
    expect(hasMovedPastSlop({ ...drag, moved: true }, 100, 2)).toBe(true);
  });
});

describe("readServerStacked", () => {
  it("never stacks on the server", () => {
    expect(readServerStacked()).toBe(false);
  });
});

describe("releaseCapture", () => {
  it("releases the pointer on a target that captures", () => {
    const releasePointerCapture = vi.fn();
    releaseCapture({ releasePointerCapture } as unknown as Element, 7);
    expect(releasePointerCapture).toHaveBeenCalledWith(7);
  });
});

describe("restoreTrack", () => {
  function stubDrag(priorTrack: string) {
    const style = { removeProperty: vi.fn(), setProperty: vi.fn() };
    const drag = { main: { style }, priorTrack } as unknown as StoryDrag;
    return { style, drag };
  }

  it("puts the prior value back", () => {
    const { style, drag } = stubDrag("500px");
    restoreTrack(drag);
    expect(style.setProperty).toHaveBeenCalledWith(
      "--story-card-track",
      "500px",
    );
  });
});
