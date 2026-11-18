// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import {
  findScreenAnchor,
  isAnchorCurrent,
  readAnchorDrift,
} from "./hold-card-position";

function makeCard(top: number, height: number): Element {
  const card = document.createElement("div");
  document.body.append(card);
  let currentTop = top;
  card.getBoundingClientRect = () =>
    ({ top: currentTop, bottom: currentTop + height }) as DOMRect;
  Object.defineProperty(card, "moveTo", {
    value: (next: number) => {
      currentTop = next;
    },
  });
  return card;
}

function moveCard(card: Element, top: number): void {
  (card as unknown as { moveTo: (next: number) => void }).moveTo(top);
}

describe("findScreenAnchor", () => {
  it("picks the first card that starts below the pinned stack", () => {
    const above = makeCard(-500, 200);
    const straddling = makeCard(-40, 300);
    const below = makeCard(400, 200);

    const anchor = findScreenAnchor([above, straddling, below], 900, 0, 110);

    expect(anchor?.element).toBe(below);
    expect(anchor?.top).toBe(400);
  });

  it("picks the card crossing the stack when it fills the viewport", () => {
    const hidden = makeCard(-500, 550);
    const filling = makeCard(-40, 1200);
    const below = makeCard(1160, 200);

    const anchor = findScreenAnchor([hidden, filling, below], 900, 0, 110);

    expect(anchor?.element).toBe(filling);
    expect(anchor?.top).toBe(-40);
  });

  it("skips a card that starts past the viewport", () => {
    const below = makeCard(1200, 200);

    expect(findScreenAnchor([below], 900, 0, 0)).toBeUndefined();
  });

  it("answers undefined for no cards", () => {
    expect(findScreenAnchor([], 900, 0, 0)).toBeUndefined();
  });
});

describe("isAnchorCurrent", () => {
  it("keeps an anchor read at the page's current scroll", () => {
    const anchor = findScreenAnchor([makeCard(100, 200)], 900, 40, 0);
    if (anchor === undefined) {
      throw new Error("expected an anchor");
    }

    expect(isAnchorCurrent(anchor, 40)).toBe(true);
    expect(isAnchorCurrent(anchor, 7350)).toBe(false);
  });
});

describe("readAnchorDrift", () => {
  it("measures how far the card moved since it was found", () => {
    const card = makeCard(100, 200);
    const anchor = findScreenAnchor([card], 900, 0, 0);
    if (anchor === undefined) {
      throw new Error("expected an anchor");
    }

    moveCard(card, 260);

    expect(readAnchorDrift(anchor)).toBe(160);
  });

  it("reads zero once the card left the document", () => {
    const card = makeCard(100, 200);
    const anchor = findScreenAnchor([card], 900, 0, 0);
    if (anchor === undefined) {
      throw new Error("expected an anchor");
    }

    card.remove();
    moveCard(card, 500);

    expect(readAnchorDrift(anchor)).toBe(0);
  });
});
