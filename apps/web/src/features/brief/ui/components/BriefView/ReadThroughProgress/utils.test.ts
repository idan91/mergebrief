// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { deriveFillStyle, revealSegment } from "./utils";

function stubBox(element: HTMLElement, left: number, right: number): void {
  element.getBoundingClientRect = () => new DOMRect(left, 0, right - left, 24);
}

function makeNav(scrollLeft: number): HTMLElement {
  const nav = document.createElement("nav");
  nav.scrollLeft = scrollLeft;
  stubBox(nav, 100, 300);
  return nav;
}

describe("revealSegment", () => {
  it("scrolls forward until a segment past the end is visible", () => {
    const nav = makeNav(0);
    const segment = document.createElement("button");
    stubBox(segment, 310, 334);
    revealSegment(nav, segment);
    expect(nav.scrollLeft).toBe(34);
  });

  it("scrolls back until a segment before the start is visible", () => {
    const nav = makeNav(50);
    const segment = document.createElement("button");
    stubBox(segment, 80, 104);
    revealSegment(nav, segment);
    expect(nav.scrollLeft).toBe(30);
  });

  it("leaves the nav alone when the segment is already visible", () => {
    const nav = makeNav(10);
    const segment = document.createElement("button");
    stubBox(segment, 150, 174);
    revealSegment(nav, segment);
    expect(nav.scrollLeft).toBe(10);
  });
});

describe("deriveFillStyle", () => {
  it("turns the fill percent into a track fraction", () => {
    expect(deriveFillStyle(50)).toEqual({ "--fill": "0.5" });
  });
});
