import { describe, expect, it } from "vitest";

import { POPOVER_VIEWPORT_PADDING_PX } from "./consts";
import { deriveCollisionPadding, deriveTransformOrigin } from "./utils";

describe("deriveTransformOrigin", () => {
  it("anchors the scale to the edge that touches the trigger", () => {
    expect(deriveTransformOrigin("bottom-end")).toBe("top right");
    expect(deriveTransformOrigin("bottom-start")).toBe("top left");
    expect(deriveTransformOrigin("top-end")).toBe("bottom right");
    expect(deriveTransformOrigin("top-start")).toBe("bottom left");
  });

  it("centres the origin on a placement with no alignment", () => {
    expect(deriveTransformOrigin("bottom")).toBe("top center");
    expect(deriveTransformOrigin("top")).toBe("bottom center");
  });

  it("grows a side placement from the edge facing the trigger", () => {
    expect(deriveTransformOrigin("left")).toBe("center right");
    expect(deriveTransformOrigin("right-start")).toBe("top left");
  });
});

describe("deriveCollisionPadding", () => {
  it("clears the pinned stack on top and the viewport elsewhere", () => {
    expect(deriveCollisionPadding(120)).toEqual({
      top: 120 + POPOVER_VIEWPORT_PADDING_PX,
      right: POPOVER_VIEWPORT_PADDING_PX,
      bottom: POPOVER_VIEWPORT_PADDING_PX,
      left: POPOVER_VIEWPORT_PADDING_PX,
    });
  });
});
