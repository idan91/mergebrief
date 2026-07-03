import { describe, expect, it } from "vitest";
import {
  validatePartition,
  validateNarrativeGroups,
  validateNarrativeMarksOverlap,
  validateReadingOrder,
  validateRiskAttrTrio,
} from "../src/validate.js";
import type { Chunk, RiskSurfaceAttribute } from "../src/types.js";

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

describe("validateReadingOrder", () => {
  const threeGroups = [{ id: "g1" }, { id: "g2" }, { id: "g3" }];

  it("returns no issues when absent", () => {
    expect(validateReadingOrder(undefined, groups)).toEqual([]);
  });

  it("returns no issues for a valid permutation", () => {
    const order = [{ groupId: "g2" }, { groupId: "g1" }];
    expect(validateReadingOrder(order, groups)).toEqual([]);
  });

  it("flags a missing group", () => {
    const order = [{ groupId: "g1" }];
    const issues = validateReadingOrder(order, groups);
    expect(issues.some((i) => i.includes("missing") && i.includes("g2"))).toBe(true);
  });

  it("flags an extra (unknown) group id", () => {
    const order = [{ groupId: "g1" }, { groupId: "g2" }, { groupId: "g9" }];
    const issues = validateReadingOrder(order, groups);
    expect(issues.some((i) => i.includes("unknown") && i.includes("g9"))).toBe(true);
  });

  it("flags a duplicate group id", () => {
    const order = [{ groupId: "g1" }, { groupId: "g1" }, { groupId: "g2" }];
    const issues = validateReadingOrder(order, threeGroups.slice(0, 2));
    expect(issues.some((i) => i.includes("more than once") && i.includes("g1"))).toBe(true);
  });

  it("keeps a valid three-group permutation", () => {
    const order = [{ groupId: "g3" }, { groupId: "g1" }, { groupId: "g2" }];
    expect(validateReadingOrder(order, threeGroups)).toEqual([]);
  });
});

function trioChunk(overrides: Partial<Chunk> & { riskSurface: RiskSurfaceAttribute[] }): Chunk {
  return {
    id: "c1",
    changeGroupId: "g1",
    file: "src/a.ts",
    concern: "implementation",
    role: "carrier",
    loc: { added: 1, deleted: 0 },
    addedRanges: [{ start: 1, end: 1 }],
    removedRanges: [],
    ...overrides,
  };
}

describe("validateRiskAttrTrio", () => {
  it("keeps comment-contradicts-code when a riskNotes citation is present", () => {
    const chunks = [
      trioChunk({
        riskSurface: ["comment-contradicts-code"],
        riskNotes: [
          {
            attr: "comment-contradicts-code",
            note: "comment says retries 3 times (L12), code retries once (L15)",
          },
        ],
      }),
    ];
    const result = validateRiskAttrTrio(chunks, []);
    expect(result.issues).toEqual([]);
    expect(result.chunks[0].riskSurface).toContain("comment-contradicts-code");
  });

  it("drops comment-contradicts-code without a note and warns; the chunk survives", () => {
    const chunks = [trioChunk({ riskSurface: ["comment-contradicts-code", "no-tests"] })];
    const result = validateRiskAttrTrio(chunks, []);
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0].riskSurface).toEqual(["no-tests"]);
    expect(
      result.issues.some((i) => i.includes("c1") && i.includes("comment-contradicts-code")),
    ).toBe(true);
    // pure: input untouched
    expect(chunks[0].riskSurface).toContain("comment-contradicts-code");
  });

  it("keeps new-dependency when a manifest diff adds a new dependency key", () => {
    const chunks = [trioChunk({ file: "package.json", riskSurface: ["new-dependency"] })];
    const patch = [
      "diff --git a/package.json b/package.json",
      "--- a/package.json",
      "+++ b/package.json",
      "@@ -10,2 +10,3 @@",
      '   "zod": "^3.25.0",',
      '+  "left-pad": "^1.3.0",',
    ].join("\n");
    const result = validateRiskAttrTrio(chunks, [{ file: "package.json", patch }]);
    expect(result.issues).toEqual([]);
    expect(result.chunks[0].riskSurface).toEqual(["new-dependency"]);
  });

  it("drops new-dependency for a version bump (same key added and removed)", () => {
    const chunks = [trioChunk({ file: "package.json", riskSurface: ["new-dependency"] })];
    const patch = [
      "diff --git a/package.json b/package.json",
      "@@ -10,1 +10,1 @@",
      '-  "zod": "^3.24.0",',
      '+  "zod": "^3.25.0",',
    ].join("\n");
    const result = validateRiskAttrTrio(chunks, [{ file: "package.json", patch }]);
    expect(result.chunks[0].riskSurface).toEqual([]);
    expect(result.issues.some((i) => i.includes("new-dependency"))).toBe(true);
  });

  it("drops new-dependency on a non-manifest file", () => {
    const chunks = [trioChunk({ file: "src/a.ts", riskSurface: ["new-dependency"] })];
    const result = validateRiskAttrTrio(chunks, [
      { file: "src/a.ts", patch: '+import leftPad from "left-pad";' },
    ]);
    expect(result.chunks[0].riskSurface).toEqual([]);
    expect(result.issues.some((i) => i.includes("not a package manifest"))).toBe(true);
  });

  it("confirms new-dependency across non-JSON manifest formats", () => {
    const cases = [
      { file: "requirements.txt", patch: "+left-pad==1.3.0" },
      { file: "go.mod", patch: "+require github.com/pkg/errors v0.9.1" },
      { file: "Gemfile", patch: '+gem "left_pad", "~> 1.0"' },
      { file: "Cargo.toml", patch: '+serde = "1.0"' },
    ];
    for (const { file, patch } of cases) {
      const result = validateRiskAttrTrio(
        [trioChunk({ file, riskSurface: ["new-dependency"] })],
        [{ file, patch }],
      );
      expect(result.chunks[0].riskSurface).toEqual(["new-dependency"]);
    }
  });

  it("passes other attributes with notes through untouched and drops a removed attribute's note", () => {
    const chunks = [
      trioChunk({
        riskSurface: ["comment-contradicts-code", "new-abstraction"],
        riskNotes: [{ attr: "new-abstraction", note: "introduces RetryPolicy class" }],
      }),
    ];
    const result = validateRiskAttrTrio(chunks, []);
    expect(result.chunks[0].riskSurface).toEqual(["new-abstraction"]);
    expect(result.chunks[0].riskNotes).toEqual([
      { attr: "new-abstraction", note: "introduces RetryPolicy class" },
    ]);
  });

  it("never drops the chunk itself", () => {
    const chunks = [
      trioChunk({ id: "c1", riskSurface: ["comment-contradicts-code"] }),
      trioChunk({ id: "c2", file: "src/b.ts", riskSurface: ["new-dependency"] }),
    ];
    const result = validateRiskAttrTrio(chunks, []);
    expect(result.chunks.map((c) => c.id)).toEqual(["c1", "c2"]);
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
