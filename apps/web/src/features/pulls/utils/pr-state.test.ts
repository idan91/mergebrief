import { describe, expect, it } from "vitest";

import { isNoLongerOpen } from "./pr-state";

describe("isNoLongerOpen", () => {
  it.each(["closed", "merged"] as const)("holds for a %s PR", (prState) => {
    expect(isNoLongerOpen(prState)).toBe(true);
  });

  it.each(["open", "unknown"] as const)("stays false for %s", (prState) => {
    expect(isNoLongerOpen(prState)).toBe(false);
  });
});
