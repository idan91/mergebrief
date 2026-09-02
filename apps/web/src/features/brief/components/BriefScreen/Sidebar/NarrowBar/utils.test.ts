import { describe, expect, it } from "vitest";

import { resolveStepTarget } from "./utils";

const groups = [{ id: "g1" }, { id: "g2" }, { id: "g3" }];

describe("resolveStepTarget", () => {
  it("steps to the neighbour", () => {
    expect(resolveStepTarget(groups, "g2", 1)).toBe("g3");
    expect(resolveStepTarget(groups, "g2", -1)).toBe("g1");
  });

  it("clamps at both ends", () => {
    expect(resolveStepTarget(groups, "g1", -1)).toBe("g1");
    expect(resolveStepTarget(groups, "g3", 1)).toBe("g3");
  });

  it("lands on the first group when none is current", () => {
    expect(resolveStepTarget(groups, null, 1)).toBe("g1");
    expect(resolveStepTarget(groups, null, -1)).toBe("g1");
  });

  it("returns nothing for an empty list", () => {
    expect(resolveStepTarget([], null, 1)).toBeUndefined();
  });
});
