import { describe, expect, it } from "vitest";
import { validatePartition } from "../src/validate.js";

const groups = [{ id: "g1" }, { id: "g2" }];

describe("validatePartition", () => {
  it("returns no issues for a clean partition", () => {
    const chunks = [
      { id: "c1", changeGroupId: "g1", role: "carrier" as const },
      { id: "c2", changeGroupId: "g1", role: "supporting" as const },
      { id: "c3", changeGroupId: "g2", role: "carrier" as const },
    ];
    expect(validatePartition(groups, chunks)).toEqual([]);
  });

  it("flags a chunk pointing at an unknown group (dangling ref)", () => {
    const chunks = [
      { id: "c1", changeGroupId: "g1", role: "carrier" as const },
      { id: "c2", changeGroupId: "g2", role: "carrier" as const },
      { id: "c3", changeGroupId: "g9", role: "supporting" as const },
    ];
    const issues = validatePartition(groups, chunks);
    expect(issues.some((i) => i.includes("c3") && i.includes("g9"))).toBe(true);
  });

  it("flags a group with no carrier chunk", () => {
    const chunks = [
      { id: "c1", changeGroupId: "g1", role: "carrier" as const },
      { id: "c2", changeGroupId: "g2", role: "supporting" as const },
    ];
    const issues = validatePartition(groups, chunks);
    expect(issues.some((i) => i.includes("g2") && i.includes("carrier"))).toBe(
      true,
    );
  });

  it("flags a group with no chunks", () => {
    const chunks = [{ id: "c1", changeGroupId: "g1", role: "carrier" as const }];
    const issues = validatePartition(groups, chunks);
    expect(issues.some((i) => i.includes("g2") && i.includes("no chunks"))).toBe(
      true,
    );
  });
});
