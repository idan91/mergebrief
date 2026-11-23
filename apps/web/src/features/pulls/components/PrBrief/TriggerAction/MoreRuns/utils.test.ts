import { describe, expect, it } from "vitest";

import { deriveMenuPlacement } from "./utils";

describe("deriveMenuPlacement", () => {
  it("opens from the start edge when the anchor sits left of centre", () => {
    expect(deriveMenuPlacement({ left: 24, right: 200 }, 390)).toBe(
      "bottom-start",
    );
  });

  it("opens from the end edge when the anchor sits right of centre", () => {
    expect(deriveMenuPlacement({ left: 680, right: 835 }, 1000)).toBe(
      "bottom-end",
    );
  });
});
