import { describe, expect, it } from "vitest";

import { deriveTransformOrigin } from "./utils";

describe("deriveTransformOrigin", () => {
  it("anchors the scale to the edge that touches the trigger", () => {
    expect(deriveTransformOrigin("bottom-end")).toBe("top right");
    expect(deriveTransformOrigin("bottom-start")).toBe("top left");
    expect(deriveTransformOrigin("top-end")).toBe("bottom right");
    expect(deriveTransformOrigin("top-start")).toBe("bottom left");
    expect(deriveTransformOrigin("bottom")).toBe("top right");
  });
});
