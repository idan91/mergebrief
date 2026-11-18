import { describe, expect, it } from "vitest";

import { ARROW_PAN_PX } from "./consts";
import { isLargerThanBox, readPanOffset, readStepOffset } from "./utils";

const PLAIN = {
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
};

describe("readStepOffset", () => {
  it("steps back on the left arrow and forward on the right", () => {
    expect(readStepOffset({ ...PLAIN, key: "ArrowLeft" })).toBe(-1);
    expect(readStepOffset({ ...PLAIN, key: "ArrowRight" })).toBe(1);
  });

  it("ignores other keys and an arrow held with a modifier", () => {
    expect(readStepOffset({ ...PLAIN, key: "ArrowUp" })).toBeUndefined();
    expect(
      readStepOffset({ ...PLAIN, key: "ArrowRight", metaKey: true }),
    ).toBeUndefined();
    expect(
      readStepOffset({ ...PLAIN, key: "ArrowLeft", altKey: true }),
    ).toBeUndefined();
  });
});

describe("readPanOffset", () => {
  it("pans one step along the arrow's axis", () => {
    expect(readPanOffset({ ...PLAIN, key: "ArrowLeft" })).toEqual({
      left: -ARROW_PAN_PX,
      top: 0,
    });
    expect(readPanOffset({ ...PLAIN, key: "ArrowDown" })).toEqual({
      left: 0,
      top: ARROW_PAN_PX,
    });
  });

  it("ignores other keys and an arrow held with a modifier", () => {
    expect(readPanOffset({ ...PLAIN, key: "Enter" })).toBeUndefined();
    expect(
      readPanOffset({ ...PLAIN, key: "ArrowUp", shiftKey: true }),
    ).toBeUndefined();
  });
});

describe("isLargerThanBox", () => {
  const box = { width: 1000, height: 600 };

  it("is larger when either side outgrows the box", () => {
    expect(isLargerThanBox({ width: 1200, height: 300 }, box)).toBe(true);
    expect(isLargerThanBox({ width: 400, height: 900 }, box)).toBe(true);
  });

  it("is not larger when the item already fits, sub-pixel rounding included", () => {
    expect(isLargerThanBox({ width: 400, height: 300 }, box)).toBe(false);
    expect(isLargerThanBox({ width: 1000.4, height: 600 }, box)).toBe(false);
  });
});
