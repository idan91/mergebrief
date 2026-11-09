// @vitest-environment jsdom
import type { VirtualItem } from "@tanstack/react-virtual";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { GroupWindow } from "../useGroupWindow";
import { WindowedCards } from ".";

const CARD_PX = 400;
const LIST_TOP = 1000;
const FIRST_PAINT_VAR = "--diff-first-paint-visibility";

afterEach(cleanup);

function makeItem(index: number): VirtualItem {
  const start = LIST_TOP + index * CARD_PX;
  return {
    key: `card-${String(index)}`,
    index,
    start,
    end: start + CARD_PX,
    size: CARD_PX,
    lane: 0,
  };
}

function stubWindow(
  indexes: readonly number[],
  viewportTop: number,
): GroupWindow {
  return {
    listRef: vi.fn(),
    measureElement: vi.fn(),
    items: indexes.map(makeItem),
    totalSize: 10 * CARD_PX,
    scrollMargin: LIST_TOP,
    viewportTop,
    active: true,
    indexOfKey: () => -1,
    scrollToKey: () => false,
    holdScrollCompensation: vi.fn(),
  };
}

function buildCard(index: number) {
  return index === 3 ? undefined : <article data-card={index} />;
}

function readSlots(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>("[data-index]")];
}

function readSpacers(container: HTMLElement): string[] {
  return [...container.querySelectorAll<HTMLElement>("[aria-hidden]")].map(
    (spacer) => spacer.style.blockSize,
  );
}

describe("WindowedCards", () => {
  it("lays the cards in flow between spacers that keep the full height", () => {
    const window = stubWindow([2, 4], 0);
    const { container } = render(
      <WindowedCards window={window} buildCard={buildCard} />,
    );

    expect(readSpacers(container)).toEqual(["800px", "400px", "2000px"]);
    expect(readSlots(container).map((slot) => slot.style.display)).toEqual([
      "flow-root",
      "flow-root",
    ]);
  });

  it("holds a missing card's track as one spacer", () => {
    const window = stubWindow([2, 3, 4], 0);
    const { container } = render(
      <WindowedCards window={window} buildCard={buildCard} />,
    );

    expect(readSlots(container).map((slot) => slot.dataset["index"])).toEqual([
      "2",
      "4",
    ]);
    expect(readSpacers(container)).toEqual(["800px", "400px", "2000px"]);
  });

  it("paints only the cards starting above the viewport in full", () => {
    const viewportTop = LIST_TOP + 5 * CARD_PX + CARD_PX / 2;
    const window = stubWindow([4, 5, 6], viewportTop);
    const { container } = render(
      <WindowedCards window={window} buildCard={buildCard} />,
    );

    const firstPaint = readSlots(container).map((slot) =>
      slot.style.getPropertyValue(FIRST_PAINT_VAR),
    );
    expect(firstPaint).toEqual(["visible", "visible", ""]);
  });
});
