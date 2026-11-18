import type { VirtualItem } from "@tanstack/react-virtual";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  deriveWindowSlots,
  FIRST_PAINT_CARD_STYLE,
  WINDOW_CARD_STYLE,
  refuseScrollCompensation,
  resolveRestingCompensation,
} from "./window-layout";

const LIST_TOP = 2000;

function makeItem(index: number, start: number, size: number): VirtualItem {
  return {
    index,
    key: `chunk-${String(index)}`,
    start,
    size,
    end: start + size,
    lane: 0,
  };
}

describe("deriveWindowSlots", () => {
  it("leads with the track from the list's start to the first card", () => {
    const items = [makeItem(3, LIST_TOP + 900, 300)];

    const { slots } = deriveWindowSlots(items, LIST_TOP, 5000, 0);

    expect(slots.map((slot) => slot.gapBefore)).toEqual([900]);
  });

  it("puts no track between neighbouring cards", () => {
    const items = [
      makeItem(0, LIST_TOP, 300),
      makeItem(1, LIST_TOP + 300, 200),
    ];

    const { slots } = deriveWindowSlots(items, LIST_TOP, 500, 0);

    expect(slots.map((slot) => slot.gapBefore)).toEqual([0, 0]);
  });

  it("spans the skipped cards before a pinned card far below", () => {
    const items = [
      makeItem(0, LIST_TOP, 300),
      makeItem(30, LIST_TOP + 9000, 400),
    ];

    const { slots } = deriveWindowSlots(items, LIST_TOP, 12_000, 0);

    expect(slots.map((slot) => slot.gapBefore)).toEqual([0, 8700]);
  });

  it("trails with the track from the last card to the list's end", () => {
    const items = [makeItem(0, LIST_TOP, 300)];

    const { trailing } = deriveWindowSlots(items, LIST_TOP, 5000, 0);

    expect(trailing).toBe(4700);
  });

  it("holds the list's whole height as one track with no cards", () => {
    const { slots, trailing } = deriveWindowSlots([], LIST_TOP, 5000, 0);

    expect(slots).toEqual([]);
    expect(trailing).toBe(5000);
  });

  it("paints cards starting above the viewport in full, spanning ones too", () => {
    const items = [
      makeItem(0, LIST_TOP, 300),
      makeItem(1, LIST_TOP + 300, 300),
      makeItem(2, LIST_TOP + 600, 300),
    ];

    const { slots } = deriveWindowSlots(items, LIST_TOP, 900, LIST_TOP + 450);

    expect(slots.map((slot) => slot.style)).toEqual([
      FIRST_PAINT_CARD_STYLE,
      FIRST_PAINT_CARD_STYLE,
      WINDOW_CARD_STYLE,
    ]);
  });

  it("adds up to the virtualizer's height for any window", () => {
    const items = [
      makeItem(2, LIST_TOP + 600, 300),
      makeItem(3, LIST_TOP + 900, 300),
    ];

    const { slots, trailing } = deriveWindowSlots(items, LIST_TOP, 6000, 0);
    const cards = items.reduce((total, item) => total + item.size, 0);
    const tracks = slots.reduce((total, slot) => total + slot.gapBefore, 0);

    expect(tracks + cards + trailing).toBe(6000);
  });
});

describe("window card styles", () => {
  it("gives every card slot its own formatting context", () => {
    expect(WINDOW_CARD_STYLE.display).toBe("flow-root");
    expect(FIRST_PAINT_CARD_STYLE.display).toBe("flow-root");
  });
});

describe("resolveRestingCompensation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("refuses the library's scroll where the browser anchors scrolling", () => {
    vi.stubGlobal("CSS", { supports: () => true });

    expect(resolveRestingCompensation()).toBe(refuseScrollCompensation);
  });

  it("keeps the library's rule where the browser has no anchoring", () => {
    vi.stubGlobal("CSS", { supports: () => false });

    expect(resolveRestingCompensation()).toBeUndefined();
  });

  it("keeps the library's rule where CSS.supports is missing", () => {
    vi.stubGlobal("CSS", { escape: (value: string) => value });

    expect(resolveRestingCompensation()).toBeUndefined();
  });
});
