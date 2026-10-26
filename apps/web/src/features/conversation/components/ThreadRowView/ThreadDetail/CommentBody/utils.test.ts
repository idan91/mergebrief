import { describe, expect, it } from "vitest";

import { deriveCommentBodyState } from "./utils";

describe("deriveCommentBodyState", () => {
  it("keeps a comment that fits whole, expanded or not", () => {
    expect(deriveCommentBodyState(false, false)).toBe("whole");
    expect(deriveCommentBodyState(false, true)).toBe("whole");
  });

  it("clamps an overflowing comment until the reader expands it", () => {
    expect(deriveCommentBodyState(true, false)).toBe("clamped");
    expect(deriveCommentBodyState(true, true)).toBe("expanded");
  });
});
