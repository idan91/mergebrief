import { describe, expect, it } from "vitest";

import { readImageNaturalSize } from "./utils";

describe("readImageNaturalSize", () => {
  it("reads natural pixels as CSS pixels, whatever the screen density", () => {
    const image = { naturalWidth: 2880, naturalHeight: 1800 };

    expect(readImageNaturalSize(image)).toEqual({ width: 2880, height: 1800 });
  });

  it.each([
    [0, 0],
    [0, 150],
    [300, 0],
  ])("reads %i by %i as no natural size", (naturalWidth, naturalHeight) => {
    expect(readImageNaturalSize({ naturalWidth, naturalHeight })).toBe(
      undefined,
    );
  });
});
