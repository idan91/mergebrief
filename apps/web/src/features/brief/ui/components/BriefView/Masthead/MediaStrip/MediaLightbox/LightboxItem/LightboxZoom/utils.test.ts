import { describe, expect, it } from "vitest";

import {
  hasDragged,
  readAnchoredScroll,
  readFittedSize,
  readZoomAnchor,
} from "./utils";

const VIEWPORT = { left: 100, top: 50, width: 1000, height: 600 };

describe("readFittedSize", () => {
  it("shrinks an item to the box, keeping its ratio", () => {
    expect(
      readFittedSize(
        { width: 2880, height: 1800 },
        { width: 1000, height: 600 },
      ),
    ).toEqual({ width: 960, height: 600 });
  });

  it("never enlarges an item smaller than the box", () => {
    expect(
      readFittedSize({ width: 400, height: 300 }, { width: 1000, height: 600 }),
    ).toEqual({ width: 400, height: 300 });
  });
});

describe("readZoomAnchor", () => {
  const item = { left: 120, top: 50, width: 960, height: 600 };

  it("anchors at the clicked point of the item, under the pointer", () => {
    const click = { clientX: 360, clientY: 200, fromKeyboard: false };

    expect(readZoomAnchor(click, item, VIEWPORT)).toEqual({
      fractionX: 0.25,
      fractionY: 0.25,
      pointerX: 260,
      pointerY: 150,
    });
  });

  it("clamps a click outside the item to its nearest edge", () => {
    const click = { clientX: 100, clientY: 700, fromKeyboard: false };

    expect(readZoomAnchor(click, item, VIEWPORT)).toMatchObject({
      fractionX: 0,
      fractionY: 1,
    });
  });

  it("anchors a keyboard zoom at the centre of item and viewport", () => {
    const click = { clientX: 0, clientY: 0, fromKeyboard: true };

    expect(readZoomAnchor(click, item, VIEWPORT)).toEqual({
      fractionX: 0.5,
      fractionY: 0.5,
      pointerX: 500,
      pointerY: 300,
    });
  });
});

describe("readAnchoredScroll", () => {
  it("scrolls so the anchored item point sits under the pointer", () => {
    const anchor = {
      fractionX: 0.25,
      fractionY: 0.25,
      pointerX: 260,
      pointerY: 150,
    };
    const zoomedItem = { left: 0, top: 0, width: 2880, height: 1800 };

    expect(readAnchoredScroll(anchor, zoomedItem)).toEqual({
      left: 460,
      top: 300,
    });
  });
});

describe("hasDragged", () => {
  it("is a drag only once the pointer moves past the threshold", () => {
    expect(hasDragged({ x: 10, y: 10 }, { x: 12, y: 12 })).toBe(false);
    expect(hasDragged({ x: 10, y: 10 }, { x: 15, y: 10 })).toBe(true);
  });
});
