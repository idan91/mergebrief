import { describe, expect, it } from "vitest";
import {
  validatePartition,
  validateMarksNarrativeCoverage,
  validateNarrativeGroups,
  validateNarrativeMarksOverlap,
  validateReadingOrder,
  validateRiskAttributes,
  validateRepoAttributeTokens,
} from "../src/validate";
import type { Chunk, RiskSurfaceAttribute } from "../src/types";

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

describe("validateRiskAttributes", () => {
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
    const result = validateRiskAttributes(chunks, []);
    expect(result.issues).toEqual([]);
    expect(result.chunks[0].riskSurface).toContain("comment-contradicts-code");
  });

  it("drops comment-contradicts-code without a note and warns; the chunk survives", () => {
    const chunks = [trioChunk({ riskSurface: ["comment-contradicts-code", "no-tests"] })];
    const result = validateRiskAttributes(chunks, []);
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0].riskSurface).toEqual(["no-tests"]);
    expect(
      result.issues.some((i) => i.includes("c1") && i.includes("comment-contradicts-code")),
    ).toBe(true);
    // pure: input untouched
    expect(chunks[0].riskSurface).toContain("comment-contradicts-code");
  });

  it("keeps new-dependency when the chunk's own added lines add a new dependency key", () => {
    const chunks = [
      trioChunk({
        file: "package.json",
        riskSurface: ["new-dependency"],
        addedRanges: [{ start: 11, end: 11 }],
      }),
    ];
    const patch = [
      "diff --git a/package.json b/package.json",
      "--- a/package.json",
      "+++ b/package.json",
      "@@ -10,2 +10,3 @@",
      '   "zod": "^3.25.0",',
      '+  "left-pad": "^1.3.0",',
    ].join("\n");
    const result = validateRiskAttributes(chunks, [{ file: "package.json", patch }]);
    expect(result.issues).toEqual([]);
    expect(result.chunks[0].riskSurface).toEqual(["new-dependency"]);
  });

  it("drops new-dependency for a version bump (same key added and removed)", () => {
    const chunks = [
      trioChunk({
        file: "package.json",
        riskSurface: ["new-dependency"],
        addedRanges: [{ start: 10, end: 10 }],
      }),
    ];
    const patch = [
      "diff --git a/package.json b/package.json",
      "@@ -10,1 +10,1 @@",
      '-  "zod": "^3.24.0",',
      '+  "zod": "^3.25.0",',
    ].join("\n");
    const result = validateRiskAttributes(chunks, [{ file: "package.json", patch }]);
    expect(result.chunks[0].riskSurface).toEqual([]);
    expect(result.issues.some((i) => i.includes("new-dependency"))).toBe(true);
  });

  it("drops new-dependency on a non-manifest file", () => {
    const chunks = [trioChunk({ file: "src/a.ts", riskSurface: ["new-dependency"] })];
    const result = validateRiskAttributes(chunks, [
      { file: "src/a.ts", patch: '+import leftPad from "left-pad";' },
    ]);
    expect(result.chunks[0].riskSurface).toEqual([]);
    expect(result.issues.some((i) => i.includes("not a package manifest"))).toBe(true);
  });

  it("confirms new-dependency across non-JSON manifest formats", () => {
    const cases = [
      {
        file: "requirements.txt",
        patch: "@@ -0,0 +1 @@\n+left-pad==1.3.0",
        range: { start: 1, end: 1 },
      },
      {
        file: "go.mod",
        patch: "@@ -5,0 +6 @@\n+require github.com/pkg/errors v0.9.1",
        range: { start: 6, end: 6 },
      },
      {
        file: "Gemfile",
        patch: '@@ -3,0 +4 @@\n+gem "left_pad", "~> 1.0"',
        range: { start: 4, end: 4 },
      },
      {
        file: "Cargo.toml",
        patch: '@@ -8,1 +8,2 @@\n [dependencies]\n+serde = "1.0"',
        range: { start: 9, end: 9 },
      },
    ];
    for (const { file, patch, range } of cases) {
      const result = validateRiskAttributes(
        [trioChunk({ file, riskSurface: ["new-dependency"], addedRanges: [range] })],
        [{ file, patch }],
      );
      expect(result.chunks[0].riskSurface).toEqual(["new-dependency"]);
    }
  });

  it("drops new-dependency when the added manifest line is not a dependency entry", () => {
    const cases = [
      {
        // package.json script under a visible "scripts" section
        file: "package.json",
        patch: [
          "@@ -5,2 +5,3 @@",
          '   "scripts": {',
          '     "build": "tsc",',
          '+    "lint": "oxlint --type-aware",',
        ].join("\n"),
        range: { start: 7, end: 7 },
      },
      {
        // package.json engines entry: version-shaped value, non-dep section
        file: "package.json",
        patch: [
          "@@ -20,1 +20,2 @@",
          '   "engines": {',
          '+    "node": ">=18",',
        ].join("\n"),
        range: { start: 21, end: 21 },
      },
      {
        // Cargo.toml [package] metadata
        file: "Cargo.toml",
        patch: ["@@ -1,2 +1,3 @@", " [package]", ' name = "app"', '+edition = "2021"'].join(
          "\n",
        ),
        range: { start: 3, end: 3 },
      },
      {
        // package.json metadata without a visible section header
        file: "package.json",
        patch: '@@ -2,0 +3 @@\n+  "packageManager": "pnpm@9.0.0",',
        range: { start: 3, end: 3 },
      },
    ];
    for (const { file, patch, range } of cases) {
      const result = validateRiskAttributes(
        [trioChunk({ file, riskSurface: ["new-dependency"], addedRanges: [range] })],
        [{ file, patch }],
      );
      expect(result.chunks[0].riskSurface).toEqual([]);
      expect(result.issues).toHaveLength(1);
    }
  });

  it("confirms only the chunk whose added ranges cover the new dependency line", () => {
    const patch = [
      "diff --git a/package.json b/package.json",
      "@@ -10,2 +10,3 @@",
      '   "dependencies": {',
      '+    "left-pad": "^1.3.0",',
      '     "zod": "^3.25.0",',
      "@@ -50,1 +51,2 @@",
      '   "scripts": {',
      '+    "lint": "oxlint",',
    ].join("\n");
    const chunks = [
      trioChunk({
        id: "c1",
        file: "package.json",
        riskSurface: ["new-dependency"],
        addedRanges: [{ start: 11, end: 11 }],
      }),
      trioChunk({
        id: "c2",
        file: "package.json",
        riskSurface: ["new-dependency"],
        addedRanges: [{ start: 52, end: 52 }],
      }),
    ];
    const result = validateRiskAttributes(chunks, [{ file: "package.json", patch }]);
    expect(result.chunks[0].riskSurface).toEqual(["new-dependency"]);
    expect(result.chunks[1].riskSurface).toEqual([]);
    expect(result.issues.some((i) => i.includes("c2"))).toBe(true);
    expect(result.issues.some((i) => i.includes("c1"))).toBe(false);
  });

  it("passes other attributes with notes through untouched and drops a removed attribute's note", () => {
    const chunks = [
      trioChunk({
        riskSurface: ["comment-contradicts-code", "new-abstraction"],
        riskNotes: [{ attr: "new-abstraction", note: "introduces RetryPolicy class" }],
      }),
    ];
    const result = validateRiskAttributes(chunks, []);
    expect(result.chunks[0].riskSurface).toEqual(["new-abstraction"]);
    expect(result.chunks[0].riskNotes).toEqual([
      { attr: "new-abstraction", note: "introduces RetryPolicy class" },
    ]);
  });

  it("drops removes-validation on a purely additive chunk", () => {
    const chunks = [
      trioChunk({
        riskSurface: ["removes-validation", "no-tests"],
        removedRanges: [],
      }),
    ];
    const result = validateRiskAttributes(chunks, []);
    expect(result.chunks[0].riskSurface).toEqual(["no-tests"]);
    expect(
      result.issues.some((i) => i.includes("removes-validation") && i.includes("no lines")),
    ).toBe(true);
  });

  it("keeps removes-validation when the chunk removes lines", () => {
    const chunks = [
      trioChunk({
        riskSurface: ["removes-validation"],
        removedRanges: [{ start: 12, end: 14 }],
      }),
    ];
    const result = validateRiskAttributes(chunks, []);
    expect(result.issues).toEqual([]);
    expect(result.chunks[0].riskSurface).toEqual(["removes-validation"]);
  });

  it("never drops the chunk itself", () => {
    const chunks = [
      trioChunk({ id: "c1", riskSurface: ["comment-contradicts-code"] }),
      trioChunk({ id: "c2", file: "src/b.ts", riskSurface: ["new-dependency"] }),
    ];
    const result = validateRiskAttributes(chunks, []);
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

describe("validateMarksNarrativeCoverage (BRIEF-73 — reverse direction)", () => {
  const marksFiles = [
    {
      file: "a.ts",
      addedRanges: [
        { start: 10, end: 15 },
        { start: 40, end: 40 },
      ],
      removedRanges: [{ start: 3, end: 4 }],
    },
  ];

  it("returns no issues when every mark range overlaps a chunk on its side", () => {
    const chunks = [
      {
        file: "a.ts",
        addedRanges: [
          { start: 12, end: 16 },
          { start: 40, end: 42 },
        ],
        removedRanges: [{ start: 4, end: 4 }],
      },
    ];
    expect(validateMarksNarrativeCoverage(marksFiles, chunks)).toEqual([]);
  });

  it("flags uncovered added ranges, formatting single lines without a dash", () => {
    const chunks = [
      { file: "a.ts", addedRanges: [{ start: 10, end: 15 }], removedRanges: [{ start: 3, end: 4 }] },
    ];
    const issues = validateMarksNarrativeCoverage(marksFiles, chunks);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("a.ts");
    expect(issues[0]).toContain("added 40");
    expect(issues[0]).not.toContain("removed");
  });

  it("flags a removed range only covered on the added side (sides never cross)", () => {
    const chunks = [
      {
        file: "a.ts",
        addedRanges: [
          { start: 10, end: 15 },
          { start: 40, end: 40 },
          { start: 3, end: 4 },
        ],
        removedRanges: [],
      },
    ];
    const issues = validateMarksNarrativeCoverage(marksFiles, chunks);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("removed 3-4");
  });

  it("flags a marks file with no narrative chunks at all", () => {
    const issues = validateMarksNarrativeCoverage(marksFiles, [
      { file: "other.ts", addedRanges: [{ start: 10, end: 15 }], removedRanges: [] },
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("added 10-15, 40");
    expect(issues[0]).toContain("removed 3-4");
  });

  it("is silent with no marks", () => {
    expect(validateMarksNarrativeCoverage([], [])).toEqual([]);
  });
});

function chunkWith(file: string, riskSurface: string[], withNote = false): Chunk {
  return {
    id: "c1",
    changeGroupId: "g1",
    file,
    concern: "implementation",
    role: "carrier",
    loc: { added: 1, deleted: 0 },
    addedRanges: [{ start: 1, end: 1 }],
    removedRanges: [],
    riskSurface,
    ...(withNote
      ? { riskNotes: riskSurface.map((attr) => ({ attr, note: "n" })) }
      : {}),
  };
}

describe("validateRepoAttributeTokens (ADR 0032 #11 — warn-and-drop floor)", () => {
  const custom = [
    { name: "touches-billing", criteria: "c", paths: ["services/billing/**"] },
    { name: "raw-sql", criteria: "c" },
  ];


  it("keeps built-ins, in-scope customs, and scope-free customs", () => {
    const { chunks, issues } = validateRepoAttributeTokens(
      [chunkWith("services/billing/x.ts", ["touches-auth", "touches-billing", "raw-sql"])],
      custom,
    );
    expect(chunks[0]?.riskSurface).toEqual(["touches-auth", "touches-billing", "raw-sql"]);
    expect(issues).toEqual([]);
  });

  it("drops an unknown token with a warning", () => {
    const { chunks, issues } = validateRepoAttributeTokens(
      [chunkWith("a.ts", ["invented-token", "mutates-state"])],
      custom,
    );
    expect(chunks[0]?.riskSurface).toEqual(["mutates-state"]);
    expect(issues.join("\n")).toContain('unknown risk token "invented-token"');
  });

  it("drops an out-of-scope custom firing and its note; built-ins are never scope-checked", () => {
    const { chunks, issues } = validateRepoAttributeTokens(
      [chunkWith("apps/web/p.tsx", ["touches-billing", "touches-auth"], true)],
      custom,
    );
    expect(chunks[0]?.riskSurface).toEqual(["touches-auth"]);
    expect(chunks[0]?.riskNotes?.map((n) => n.attr)).toEqual(["touches-auth"]);
    expect(issues.join("\n")).toContain("outside its path scope");
  });

  it("is pure — the input chunks are not mutated", () => {
    const input = [chunkWith("a.ts", ["invented-token"])];
    validateRepoAttributeTokens(input, custom);
    expect(input[0]?.riskSurface).toEqual(["invented-token"]);
  });
});

describe("validateRepoAttributeTokens — riskNotes cannot smuggle tokens (codex r1)", () => {
  const custom = [
    { name: "touches-billing", criteria: "c", paths: ["services/billing/**"] },
  ];

  it("drops a note whose attr never appeared on riskSurface but is out of scope or unknown", () => {
    const chunk = {
      ...chunkWith("apps/web/p.tsx", ["mutates-state"]),
      riskNotes: [
        { attr: "touches-billing", note: "out of scope, notes only" },
        { attr: "mutates-state", note: "fine" },
      ],
    };
    const { chunks, issues } = validateRepoAttributeTokens([chunk], custom);
    expect(chunks[0]?.riskNotes?.map((n) => n.attr)).toEqual(["mutates-state"]);
    expect(issues.join("\n")).toContain("riskNotes");
  });
});
