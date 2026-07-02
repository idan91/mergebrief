import { describe, expect, it } from "vitest";
import {
  validatePartition,
  validateNarrativeGroups,
  validateNarrativeMarksOverlap,
} from "../src/validate.js";

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

describe("validateNarrativeGroups", () => {
  it("returns no issues when every briefChangeGroupId exists", () => {
    const chunks = [
      { id: "rc1", briefChangeGroupId: "g1" },
      { id: "rc2", briefChangeGroupId: "g2" },
    ];
    expect(validateNarrativeGroups(chunks, groups)).toEqual([]);
  });

  it("warns (returns an issue) when a briefChangeGroupId does not exist on the current Brief", () => {
    const chunks = [{ id: "rc1", briefChangeGroupId: "g9" }];
    const issues = validateNarrativeGroups(chunks, groups);
    expect(issues.some((i) => i.includes("rc1") && i.includes("g9"))).toBe(true);
  });
});

describe("validateNarrativeMarksOverlap", () => {
  const marksFiles = [
    { file: "a.ts", addedRanges: [{ start: 10, end: 15 }], removedRanges: [{ start: 3, end: 4 }] },
  ];

  it("returns no issues when a chunk's added range overlaps a mark's added range", () => {
    const chunks = [
      { id: "rc1", file: "a.ts", addedRanges: [{ start: 12, end: 12 }], removedRanges: [] },
    ];
    expect(validateNarrativeMarksOverlap(chunks, marksFiles)).toEqual([]);
  });

  it("returns no issues when a chunk's removed range overlaps a mark's removed range", () => {
    const chunks = [
      { id: "rc1", file: "a.ts", addedRanges: [], removedRanges: [{ start: 3, end: 3 }] },
    ];
    expect(validateNarrativeMarksOverlap(chunks, marksFiles)).toEqual([]);
  });

  it("flags a chunk with no overlapping mark for its file", () => {
    const chunks = [
      { id: "rc1", file: "a.ts", addedRanges: [{ start: 100, end: 100 }], removedRanges: [] },
    ];
    const issues = validateNarrativeMarksOverlap(chunks, marksFiles);
    expect(issues.some((i) => i.includes("rc1") && i.includes("a.ts"))).toBe(true);
  });

  it("flags a chunk referencing a file with no marks at all", () => {
    const chunks = [
      { id: "rc1", file: "other.ts", addedRanges: [{ start: 1, end: 1 }], removedRanges: [] },
    ];
    const issues = validateNarrativeMarksOverlap(chunks, marksFiles);
    expect(issues.some((i) => i.includes("rc1"))).toBe(true);
  });
});
