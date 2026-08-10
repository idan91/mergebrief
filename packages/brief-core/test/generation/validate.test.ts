import { describe, expect, it } from "vitest";
import {
  fanOutIntentCheck,
  validateIntentCheck,
  validatePartition,
  validateMarksNarrativeCoverage,
  validateNarrativeGroups,
  validateNarrativeMarksOverlap,
  validateReadingOrder,
  validateRiskAttributes,
  validateRepoAttributeTokens,
  validateTextLength,
  validateNarrativeTextLength,
} from "../../src/generation/validate";
import type { Chunk, RiskSurfaceAttribute } from "../../src/types";

const groups = [{ id: "g1" }, { id: "g2" }];

describe("validatePartition", () => {
  it("returns no issues for a clean partition", () => {
    const chunks = [
      { id: "c1", changeGroupId: "g1", role: "core" as const },
      { id: "c2", changeGroupId: "g1", role: "supporting" as const },
      { id: "c3", changeGroupId: "g2", role: "core" as const },
    ];
    expect(validatePartition(groups, chunks)).toEqual([]);
  });

  it("flags a chunk pointing at an unknown group (dangling ref)", () => {
    const chunks = [
      { id: "c1", changeGroupId: "g1", role: "core" as const },
      { id: "c2", changeGroupId: "g2", role: "core" as const },
      { id: "c3", changeGroupId: "g9", role: "supporting" as const },
    ];
    const issues = validatePartition(groups, chunks);
    expect(issues.some((i) => i.includes("c3") && i.includes("g9"))).toBe(true);
  });

  it("flags a group with no core chunk", () => {
    const chunks = [
      { id: "c1", changeGroupId: "g1", role: "core" as const },
      { id: "c2", changeGroupId: "g2", role: "supporting" as const },
    ];
    const issues = validatePartition(groups, chunks);
    expect(issues.some((i) => i.includes("g2") && i.includes("core"))).toBe(
      true,
    );
  });

  it("flags a group with no chunks", () => {
    const chunks = [{ id: "c1", changeGroupId: "g1", role: "core" as const }];
    const issues = validatePartition(groups, chunks);
    expect(
      issues.some((i) => i.includes("g2") && i.includes("no chunks")),
    ).toBe(true);
  });
});

describe("validateReadingOrder — carried (frozen) ids on anchored runs", () => {
  const emitted = [{ id: "tmp1" }];

  it("accepts an order spanning emitted + carried ids and demands BOTH", () => {
    expect(
      validateReadingOrder(
        [{ groupId: "gFrozen" }, { groupId: "tmp1" }],
        emitted,
        ["gFrozen"],
      ),
    ).toEqual([]);
    // Missing the carried id is an issue — the anchored contract demands the
    // whole ordering, frozen ids included.
    expect(
      validateReadingOrder([{ groupId: "tmp1" }], emitted, ["gFrozen"]).length,
    ).toBeGreaterThan(0);
  });

  it("keeps rejecting genuinely unknown ids alongside carried ones", () => {
    const issues = validateReadingOrder(
      [{ groupId: "gFrozen" }, { groupId: "tmp1" }, { groupId: "ghost" }],
      emitted,
      ["gFrozen"],
    );
    expect(issues.join(" ")).toContain("ghost");
  });

  it("without carried ids behaves exactly as before (fresh path untouched)", () => {
    expect(validateReadingOrder([{ groupId: "tmp1" }], emitted)).toEqual([]);
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
    expect(issues.some((i) => i.includes("rc1") && i.includes("g9"))).toBe(
      true,
    );
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
    expect(issues.some((i) => i.includes("missing") && i.includes("g2"))).toBe(
      true,
    );
  });

  it("flags an extra (unknown) group id", () => {
    const order = [{ groupId: "g1" }, { groupId: "g2" }, { groupId: "g9" }];
    const issues = validateReadingOrder(order, groups);
    expect(issues.some((i) => i.includes("unknown") && i.includes("g9"))).toBe(
      true,
    );
  });

  it("flags a duplicate group id", () => {
    const order = [{ groupId: "g1" }, { groupId: "g1" }, { groupId: "g2" }];
    const issues = validateReadingOrder(order, threeGroups.slice(0, 2));
    expect(
      issues.some((i) => i.includes("more than once") && i.includes("g1")),
    ).toBe(true);
  });

  it("keeps a valid three-group permutation", () => {
    const order = [{ groupId: "g3" }, { groupId: "g1" }, { groupId: "g2" }];
    expect(validateReadingOrder(order, threeGroups)).toEqual([]);
  });
});

function trioChunk(
  overrides: Partial<Chunk> & { riskSurface: RiskSurfaceAttribute[] },
): Chunk {
  return {
    id: "c1",
    changeGroupId: "g1",
    file: "src/a.ts",
    concern: "implementation",
    role: "core",
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
    const chunks = [
      trioChunk({ riskSurface: ["comment-contradicts-code", "no-tests"] }),
    ];
    const result = validateRiskAttributes(chunks, []);
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0].riskSurface).toEqual(["no-tests"]);
    expect(
      result.issues.some(
        (i) => i.includes("c1") && i.includes("comment-contradicts-code"),
      ),
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
    const result = validateRiskAttributes(chunks, [
      { file: "package.json", patch },
    ]);
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
    const result = validateRiskAttributes(chunks, [
      { file: "package.json", patch },
    ]);
    expect(result.chunks[0].riskSurface).toEqual([]);
    expect(result.issues.some((i) => i.includes("new-dependency"))).toBe(true);
  });

  it("drops new-dependency on a non-manifest file", () => {
    const chunks = [
      trioChunk({ file: "src/a.ts", riskSurface: ["new-dependency"] }),
    ];
    const result = validateRiskAttributes(chunks, [
      { file: "src/a.ts", patch: '+import leftPad from "left-pad";' },
    ]);
    expect(result.chunks[0].riskSurface).toEqual([]);
    expect(
      result.issues.some((i) => i.includes("not a package manifest")),
    ).toBe(true);
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
        [
          trioChunk({
            file,
            riskSurface: ["new-dependency"],
            addedRanges: [range],
          }),
        ],
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
        patch: [
          "@@ -1,2 +1,3 @@",
          " [package]",
          ' name = "app"',
          '+edition = "2021"',
        ].join("\n"),
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
        [
          trioChunk({
            file,
            riskSurface: ["new-dependency"],
            addedRanges: [range],
          }),
        ],
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
    const result = validateRiskAttributes(chunks, [
      { file: "package.json", patch },
    ]);
    expect(result.chunks[0].riskSurface).toEqual(["new-dependency"]);
    expect(result.chunks[1].riskSurface).toEqual([]);
    expect(result.issues.some((i) => i.includes("c2"))).toBe(true);
    expect(result.issues.some((i) => i.includes("c1"))).toBe(false);
  });

  it("passes other attributes with notes through untouched and drops a removed attribute's note", () => {
    const chunks = [
      trioChunk({
        riskSurface: ["comment-contradicts-code", "new-abstraction"],
        riskNotes: [
          { attr: "new-abstraction", note: "introduces RetryPolicy class" },
        ],
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
      result.issues.some(
        (i) => i.includes("removes-validation") && i.includes("no lines"),
      ),
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
      trioChunk({
        id: "c2",
        file: "src/b.ts",
        riskSurface: ["new-dependency"],
      }),
    ];
    const result = validateRiskAttributes(chunks, []);
    expect(result.chunks.map((c) => c.id)).toEqual(["c1", "c2"]);
  });
});

describe("validateNarrativeMarksOverlap", () => {
  const marksFiles = [
    {
      file: "a.ts",
      addedRanges: [{ start: 10, end: 15 }],
      removedRanges: [{ start: 3, end: 4 }],
    },
  ];

  it("returns no issues when a chunk's added range overlaps a mark's added range", () => {
    const chunks = [
      {
        id: "rc1",
        file: "a.ts",
        addedRanges: [{ start: 12, end: 12 }],
        removedRanges: [],
      },
    ];
    expect(validateNarrativeMarksOverlap(chunks, marksFiles)).toEqual([]);
  });

  it("returns no issues when a chunk's removed range overlaps a mark's removed range", () => {
    const chunks = [
      {
        id: "rc1",
        file: "a.ts",
        addedRanges: [],
        removedRanges: [{ start: 3, end: 3 }],
      },
    ];
    expect(validateNarrativeMarksOverlap(chunks, marksFiles)).toEqual([]);
  });

  it("flags a chunk with no overlapping mark for its file", () => {
    const chunks = [
      {
        id: "rc1",
        file: "a.ts",
        addedRanges: [{ start: 100, end: 100 }],
        removedRanges: [],
      },
    ];
    const issues = validateNarrativeMarksOverlap(chunks, marksFiles);
    expect(issues.some((i) => i.includes("rc1") && i.includes("a.ts"))).toBe(
      true,
    );
  });

  it("flags a chunk referencing a file with no marks at all", () => {
    const chunks = [
      {
        id: "rc1",
        file: "other.ts",
        addedRanges: [{ start: 1, end: 1 }],
        removedRanges: [],
      },
    ];
    const issues = validateNarrativeMarksOverlap(chunks, marksFiles);
    expect(issues.some((i) => i.includes("rc1"))).toBe(true);
  });
});

describe("validateMarksNarrativeCoverage (reverse direction)", () => {
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
      {
        file: "a.ts",
        addedRanges: [{ start: 10, end: 15 }],
        removedRanges: [{ start: 3, end: 4 }],
      },
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
      {
        file: "other.ts",
        addedRanges: [{ start: 10, end: 15 }],
        removedRanges: [],
      },
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("added 10-15, 40");
    expect(issues[0]).toContain("removed 3-4");
  });

  it("is silent with no marks", () => {
    expect(validateMarksNarrativeCoverage([], [])).toEqual([]);
  });
});

function chunkWith(
  file: string,
  riskSurface: string[],
  withNote = false,
): Chunk {
  return {
    id: "c1",
    changeGroupId: "g1",
    file,
    concern: "implementation",
    role: "core",
    loc: { added: 1, deleted: 0 },
    addedRanges: [{ start: 1, end: 1 }],
    removedRanges: [],
    riskSurface,
    ...(withNote
      ? { riskNotes: riskSurface.map((attr) => ({ attr, note: "n" })) }
      : {}),
  };
}

describe("validateRepoAttributeTokens (warn-and-drop floor)", () => {
  const custom = [
    { name: "touches-billing", criteria: "c", paths: ["services/billing/**"] },
    { name: "raw-sql", criteria: "c" },
  ];

  it("keeps built-ins, in-scope customs, and scope-free customs", () => {
    const { chunks, issues } = validateRepoAttributeTokens(
      [
        chunkWith("services/billing/x.ts", [
          "touches-auth",
          "touches-billing",
          "raw-sql",
        ]),
      ],
      custom,
    );
    expect(chunks[0]?.riskSurface).toEqual([
      "touches-auth",
      "touches-billing",
      "raw-sql",
    ]);
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

describe("validateIntentCheck", () => {
  const emittedGroups = [{ id: "g1" }, { id: "g2" }];
  const ticketUrl = "https://tracker.example/T-1";
  const injected = [ticketUrl, "https://docs.example/design"];
  const sources = [
    { url: "", content: "Fix the retry loop\n\nAlso tidy the logger setup." },
    {
      url: ticketUrl,
      content:
        "The retry loop must stop after three attempts.\nAdd a regression   test for the overflow case.",
    },
  ];

  const preciseCheck = () => ({
    ticketUrls: [ticketUrl],
    specificity: "precise" as const,
    scopeNote: "",
    accomplished: [
      {
        intent: "stop retrying after three attempts",
        quote: "must stop after three attempts",
        sourceUrl: ticketUrl,
        groupIds: ["g1"],
        acknowledged: false,
      },
    ],
    statedButMissing: [
      {
        intent: "add a regression test",
        quote: "Add a regression test for the overflow case.",
        sourceUrl: ticketUrl,
        groupIds: [],
        acknowledged: false,
      },
    ],
    doneButUnstated: [
      {
        intent: "tidies the logger setup",
        quote: "",
        sourceUrl: "",
        groupIds: ["g2"],
        acknowledged: false,
      },
    ],
    deviations: [],
    claimedButUnachieved: [],
  });

  /** A grounded alarm-bucket item — verifiable quote + valid group anchor. */
  const alarmItem = () => ({
    intent: "reverses the retry-stop ask",
    quote: "must stop after three attempts",
    sourceUrl: ticketUrl,
    groupIds: ["g1"],
    acknowledged: false,
  });

  it("passes a clean precise check through untouched with no issues", () => {
    const input = preciseCheck();
    const { intentCheck, issues } = validateIntentCheck(
      input,
      emittedGroups,
      injected,
      sources,
    );
    expect(issues).toEqual([]);
    expect(intentCheck).toEqual(input);
  });

  it("empties all buckets when specificity is broad/none but buckets are non-empty", () => {
    for (const specificity of ["broad", "none"] as const) {
      const { intentCheck, issues } = validateIntentCheck(
        { ...preciseCheck(), specificity },
        groups,
        injected,
        sources,
      );
      expect(intentCheck.accomplished).toEqual([]);
      expect(intentCheck.statedButMissing).toEqual([]);
      expect(intentCheck.doneButUnstated).toEqual([]);
      expect(issues.join("\n")).toContain(specificity);
    }
  });

  it("leaves an already-empty broad check clean (no issues)", () => {
    const { issues } = validateIntentCheck(
      {
        ticketUrls: [ticketUrl],
        specificity: "broad",
        scopeNote: "parent epic spans several PRs",
        accomplished: [],
        statedButMissing: [],
        doneButUnstated: [],
        deviations: [],
        claimedButUnachieved: [],
      },
      groups,
      injected,
      sources,
    );
    expect(issues).toEqual([]);
  });

  it("drops a ticketUrl the harness never injected, and the items citing it", () => {
    const forged = "https://evil.example/T-666";
    const input = {
      ...preciseCheck(),
      ticketUrls: [ticketUrl, forged],
      statedButMissing: [
        {
          intent: "invented ask",
          quote: "do the forged thing",
          sourceUrl: forged,
          groupIds: [],
          acknowledged: false,
        },
      ],
    };
    const { intentCheck, issues } = validateIntentCheck(
      input,
      emittedGroups,
      injected,
      sources,
    );
    expect(intentCheck.ticketUrls).toEqual([ticketUrl]);
    expect(intentCheck.statedButMissing).toEqual([]);
    expect(issues.join("\n")).toContain(forged);
    expect(
      issues.filter((i) => i.includes(forged)).length,
    ).toBeGreaterThanOrEqual(2);
  });

  it('accepts sourceUrl "" (title/description) without requiring ticketUrls membership', () => {
    const input = {
      ...preciseCheck(),
      accomplished: [
        {
          intent: "fix the retry loop",
          quote: "Fix the retry loop",
          sourceUrl: "",
          groupIds: ["g1"],
          acknowledged: false,
        },
      ],
    };
    const { intentCheck, issues } = validateIntentCheck(
      input,
      emittedGroups,
      injected,
      sources,
    );
    expect(intentCheck.accomplished).toHaveLength(1);
    expect(issues).toEqual([]);
  });

  it("prunes a dangling groupId from an accomplished ask but keeps the item", () => {
    const input = {
      ...preciseCheck(),
      accomplished: [
        { ...preciseCheck().accomplished[0]!, groupIds: ["g1", "g9"] },
      ],
    };
    const { intentCheck, issues } = validateIntentCheck(
      input,
      emittedGroups,
      injected,
      sources,
    );
    expect(intentCheck.accomplished[0]?.groupIds).toEqual(["g1"]);
    expect(issues.join("\n")).toContain('"g9"');
  });

  it("keeps an accomplished ask alive even when ALL its groupIds were dangling (stated-side survives), but warns", () => {
    const input = {
      ...preciseCheck(),
      accomplished: [{ ...preciseCheck().accomplished[0]!, groupIds: ["g9"] }],
    };
    const { intentCheck, issues } = validateIntentCheck(
      input,
      emittedGroups,
      injected,
      sources,
    );
    expect(intentCheck.accomplished).toHaveLength(1);
    expect(intentCheck.accomplished[0]?.groupIds).toEqual([]);
    expect(issues.join("\n")).toContain(
      "kept (stated-side grounding is the citation)",
    );
  });

  it("warns (never drops) on an accomplished ask emitted with zero groupIds", () => {
    const input = {
      ...preciseCheck(),
      accomplished: [{ ...preciseCheck().accomplished[0]!, groupIds: [] }],
    };
    const { intentCheck, issues } = validateIntentCheck(
      input,
      emittedGroups,
      injected,
      sources,
    );
    expect(intentCheck.accomplished).toHaveLength(1);
    expect(issues.join("\n")).toContain("no valid group anchor — kept");
  });

  it("drops a doneButUnstated item whose groupIds all dangle (no grounding)", () => {
    const input = {
      ...preciseCheck(),
      doneButUnstated: [
        {
          intent: "ungrounded claim",
          quote: "",
          sourceUrl: "",
          groupIds: ["g9"],
          acknowledged: false,
        },
        {
          intent: "grounded claim",
          quote: "",
          sourceUrl: "",
          groupIds: ["g2", "g9"],
          acknowledged: false,
        },
      ],
    };
    const { intentCheck, issues } = validateIntentCheck(
      input,
      emittedGroups,
      injected,
      sources,
    );
    expect(intentCheck.doneButUnstated).toHaveLength(1);
    expect(intentCheck.doneButUnstated[0]?.intent).toBe("grounded claim");
    expect(intentCheck.doneButUnstated[0]?.groupIds).toEqual(["g2"]);
    expect(issues.join("\n")).toContain("ungrounded claim");
  });

  it("empties groupIds on a statedButMissing item and warns (no diff anchor by definition)", () => {
    const input = {
      ...preciseCheck(),
      statedButMissing: [
        {
          intent: "add a regression test",
          quote: "Add a regression test for the overflow case.",
          sourceUrl: ticketUrl,
          groupIds: ["g1", "g9"],
          acknowledged: false,
        },
      ],
    };
    const { intentCheck, issues } = validateIntentCheck(
      input,
      emittedGroups,
      injected,
      sources,
    );
    expect(intentCheck.statedButMissing[0]?.groupIds).toEqual([]);
    expect(issues.join("\n")).toContain("no diff anchor");
  });

  it("warns (never drops) on a quote that is not a whitespace-normalized substring of its source", () => {
    const input = {
      ...preciseCheck(),
      statedButMissing: [
        {
          intent: "fabricated ask",
          quote: "this sentence appears nowhere in the ticket",
          sourceUrl: ticketUrl,
          groupIds: [],
          acknowledged: false,
        },
      ],
    };
    const { intentCheck, issues } = validateIntentCheck(
      input,
      emittedGroups,
      injected,
      sources,
    );
    expect(intentCheck.statedButMissing).toHaveLength(1);
    expect(issues.join("\n")).toContain("quote");
  });

  it("normalizes whitespace before the substring check (line breaks and runs of spaces match)", () => {
    const input = {
      ...preciseCheck(),
      statedButMissing: [
        {
          intent: "add a regression test",
          quote: "Add a regression\ntest for the overflow case.",
          sourceUrl: ticketUrl,
          groupIds: [],
          acknowledged: false,
        },
      ],
    };
    const { issues } = validateIntentCheck(
      input,
      emittedGroups,
      injected,
      sources,
    );
    expect(issues).toEqual([]);
  });

  it("warns on an EMPTY ticket-side quote (uncited stated ask — schema demands verbatim citation)", () => {
    const input = {
      ...preciseCheck(),
      statedButMissing: [
        {
          intent: "uncited ask",
          quote: "",
          sourceUrl: ticketUrl,
          groupIds: [],
          acknowledged: false,
        },
      ],
    };
    const { intentCheck, issues } = validateIntentCheck(
      input,
      emittedGroups,
      injected,
      sources,
    );
    expect(intentCheck.statedButMissing).toHaveLength(1);
    expect(issues.join("\n")).toContain("empty quote");
  });

  it("does not warn on doneButUnstated's empty quote (no ticket side by design)", () => {
    const input = {
      ...preciseCheck(),
      doneButUnstated: [
        {
          intent: "cleanup",
          quote: "",
          sourceUrl: "",
          groupIds: ["g2"],
          acknowledged: false,
        },
      ],
    };
    const { issues } = validateIntentCheck(
      input,
      emittedGroups,
      injected,
      sources,
    );
    expect(issues).toEqual([]);
  });

  it("is pure — the input intent check is not mutated", () => {
    const input = { ...preciseCheck(), specificity: "broad" as const };
    validateIntentCheck(input, emittedGroups, injected, sources);
    expect(input.accomplished).toHaveLength(1);
  });

  describe("alarm buckets — drop, never warn-and-keep", () => {
    for (const bucket of ["deviations", "claimedButUnachieved"] as const) {
      it(`keeps a fully grounded ${bucket} item untouched`, () => {
        const input = { ...preciseCheck(), [bucket]: [alarmItem()] };
        const { intentCheck, issues } = validateIntentCheck(
          input,
          emittedGroups,
          injected,
          sources,
        );
        expect(issues).toEqual([]);
        expect(intentCheck[bucket]).toEqual([alarmItem()]);
      });

      it(`drops a ${bucket} item with an EMPTY quote (neutral siblings only warn)`, () => {
        const input = {
          ...preciseCheck(),
          [bucket]: [{ ...alarmItem(), quote: "" }],
        };
        const { intentCheck, issues } = validateIntentCheck(
          input,
          emittedGroups,
          injected,
          sources,
        );
        expect(intentCheck[bucket]).toEqual([]);
        expect(issues.join("\n")).toContain("empty quote");
        expect(issues.join("\n")).toContain("dropped");
      });

      it(`drops a ${bucket} item whose quote is a bare fragment, even when it verifies`, () => {
        // "must stop" IS a substring of the ticket content — length, not
        // presence, is what fails here.
        const input = {
          ...preciseCheck(),
          [bucket]: [{ ...alarmItem(), quote: "must stop" }],
        };
        const { intentCheck, issues } = validateIntentCheck(
          input,
          emittedGroups,
          injected,
          sources,
        );
        expect(intentCheck[bucket]).toEqual([]);
        expect(issues.join("\n")).toContain("too short to verify");
      });

      it(`drops a ${bucket} item whose quote is not found in its source`, () => {
        const input = {
          ...preciseCheck(),
          [bucket]: [
            {
              ...alarmItem(),
              quote: "this sentence appears nowhere in the source",
            },
          ],
        };
        const { intentCheck, issues } = validateIntentCheck(
          input,
          emittedGroups,
          injected,
          sources,
        );
        expect(intentCheck[bucket]).toEqual([]);
        expect(issues.join("\n")).toContain("possible fabrication");
      });

      it(`drops a ${bucket} item whose quote source has no fetched content`, () => {
        const input = { ...preciseCheck(), [bucket]: [alarmItem()] };
        const sansTicketContent = sources.filter((s) => s.url !== ticketUrl);
        const { intentCheck, issues } = validateIntentCheck(
          input,
          emittedGroups,
          injected,
          sansTicketContent,
        );
        expect(intentCheck[bucket]).toEqual([]);
        expect(issues.join("\n")).toContain("unverifiable");
      });

      it(`drops a ${bucket} item once ALL its groupIds dangle (both-sides grounding)`, () => {
        const input = {
          ...preciseCheck(),
          [bucket]: [{ ...alarmItem(), groupIds: ["g9"] }],
        };
        const { intentCheck, issues } = validateIntentCheck(
          input,
          emittedGroups,
          injected,
          sources,
        );
        expect(intentCheck[bucket]).toEqual([]);
        expect(issues.join("\n")).toContain("both-sides grounding required");
      });

      it(`prunes dangling groupIds on a ${bucket} item but keeps it while one anchor survives`, () => {
        const input = {
          ...preciseCheck(),
          [bucket]: [{ ...alarmItem(), groupIds: ["g1", "g9"] }],
        };
        const { intentCheck, issues } = validateIntentCheck(
          input,
          emittedGroups,
          injected,
          sources,
        );
        expect(intentCheck[bucket]).toHaveLength(1);
        expect(intentCheck[bucket][0]?.groupIds).toEqual(["g1"]);
        expect(issues.join("\n")).toContain('"g9"');
      });

      it(`drops a ${bucket} item citing an un-injected source`, () => {
        const forged = "https://evil.example/T-666";
        const input = {
          ...preciseCheck(),
          [bucket]: [{ ...alarmItem(), sourceUrl: forged }],
        };
        const { intentCheck, issues } = validateIntentCheck(
          input,
          emittedGroups,
          injected,
          sources,
        );
        expect(intentCheck[bucket]).toEqual([]);
        expect(issues.join("\n")).toContain(forged);
      });
    }

    it("accepts an acknowledged deviation untouched (quiet receipt)", () => {
      const input = {
        ...preciseCheck(),
        deviations: [{ ...alarmItem(), acknowledged: true }],
      };
      const { intentCheck, issues } = validateIntentCheck(
        input,
        emittedGroups,
        injected,
        sources,
      );
      expect(issues).toEqual([]);
      expect(intentCheck.deviations[0]?.acknowledged).toBe(true);
    });

    it("forces acknowledged=false outside deviations, on every other bucket, and warns", () => {
      const input = {
        ...preciseCheck(),
        accomplished: [
          { ...preciseCheck().accomplished[0]!, acknowledged: true },
        ],
        statedButMissing: [
          { ...preciseCheck().statedButMissing[0]!, acknowledged: true },
        ],
        doneButUnstated: [
          { ...preciseCheck().doneButUnstated[0]!, acknowledged: true },
        ],
        claimedButUnachieved: [{ ...alarmItem(), acknowledged: true }],
      };
      const { intentCheck, issues } = validateIntentCheck(
        input,
        emittedGroups,
        injected,
        sources,
      );
      expect(intentCheck.accomplished[0]?.acknowledged).toBe(false);
      expect(intentCheck.statedButMissing[0]?.acknowledged).toBe(false);
      expect(intentCheck.doneButUnstated[0]?.acknowledged).toBe(false);
      expect(intentCheck.claimedButUnachieved[0]?.acknowledged).toBe(false);
      const acknowledgedIssues = issues.filter((i) =>
        i.includes("forced false (meaningful only in deviations)"),
      );
      expect(acknowledgedIssues).toHaveLength(4);
    });

    it("empties the alarm buckets too when specificity is broad/none", () => {
      const input = {
        ...preciseCheck(),
        specificity: "broad" as const,
        deviations: [alarmItem()],
        claimedButUnachieved: [alarmItem()],
      };
      const { intentCheck, issues } = validateIntentCheck(
        input,
        emittedGroups,
        injected,
        sources,
      );
      expect(intentCheck.deviations).toEqual([]);
      expect(intentCheck.claimedButUnachieved).toEqual([]);
      expect(issues.join("\n")).toContain("never a guessed gap");
    });
  });
});

/** One tagged wire item — the shape generation actually emits. */
const genItem = (bucket: string, intent: string, overrides = {}) => ({
  bucket,
  intent,
  quote: "q",
  sourceUrl: "",
  groupIds: ["g1"],
  acknowledged: false,
  ...overrides,
});

describe("fanOutIntentCheck (grammar budget)", () => {
  it("dispatches each tagged item into its stored bucket and drops the tag", () => {
    const out = fanOutIntentCheck({
      ticketUrls: ["https://tracker.example/T-1"],
      specificity: "precise",
      scopeNote: "note",
      items: [
        genItem("accomplished", "did the thing"),
        genItem("statedButMissing", "missed the thing"),
        genItem("doneButUnstated", "extra thing"),
        genItem("deviations", "opposed the thing", { acknowledged: true }),
        genItem("claimedButUnachieved", "masked the thing"),
      ],
    });
    expect(out.accomplished.map((i) => i.intent)).toEqual(["did the thing"]);
    expect(out.statedButMissing.map((i) => i.intent)).toEqual([
      "missed the thing",
    ]);
    expect(out.doneButUnstated.map((i) => i.intent)).toEqual(["extra thing"]);
    expect(out.deviations.map((i) => i.intent)).toEqual(["opposed the thing"]);
    expect(out.claimedButUnachieved.map((i) => i.intent)).toEqual([
      "masked the thing",
    ]);
    // The bucket tag is wire framing — it never reaches the stored artifact.
    expect(out.accomplished[0]).not.toHaveProperty("bucket");
    expect(out.deviations[0]?.acknowledged).toBe(true);
    // Scalars ride through untouched.
    expect(out.ticketUrls).toEqual(["https://tracker.example/T-1"]);
    expect(out.specificity).toBe("precise");
    expect(out.scopeNote).toBe("note");
  });

  it("preserves order within a bucket and keeps multiple items per bucket", () => {
    const out = fanOutIntentCheck({
      ticketUrls: [],
      specificity: "precise",
      scopeNote: "",
      items: [
        genItem("accomplished", "first"),
        genItem("deviations", "dev"),
        genItem("accomplished", "second"),
      ],
    });
    expect(out.accomplished.map((i) => i.intent)).toEqual(["first", "second"]);
    expect(out.deviations).toHaveLength(1);
  });

  it("yields five empty buckets for an empty items array (the broad/none path)", () => {
    const out = fanOutIntentCheck({
      ticketUrls: [],
      specificity: "none",
      scopeNote: "",
      items: [],
    });
    expect(out.accomplished).toEqual([]);
    expect(out.statedButMissing).toEqual([]);
    expect(out.doneButUnstated).toEqual([]);
    expect(out.deviations).toEqual([]);
    expect(out.claimedButUnachieved).toEqual([]);
  });

  it("round-trips into the validator: a fanned-out check validates like a native one", () => {
    const fanned = fanOutIntentCheck({
      ticketUrls: [],
      specificity: "precise",
      scopeNote: "",
      items: [
        // Alarm item with an unverifiable quote — the validator must still drop it.
        genItem("deviations", "ungrounded alarm", {
          quote: "this ask appears nowhere in the sources",
        }),
      ],
    });
    const { intentCheck, issues } = validateIntentCheck(
      fanned,
      [{ id: "g1" }],
      [],
      [{ url: "", content: "the source text" }],
    );
    expect(intentCheck.deviations).toEqual([]);
    expect(issues.join("\n")).toContain("possible fabrication");
  });
});

const group = (id: string, title: string, summary: string) => ({
  id,
  title,
  summary,
});

describe("validateTextLength (warn-only length floor)", () => {
  it("passes text at or under every cap with no violations", () => {
    const { violations, issues } = validateTextLength(
      [group("g1", "a".repeat(150), "b".repeat(250))],
      [
        {
          id: "c1",
          riskNotes: [{ attr: "touches-auth", note: "n".repeat(200) }],
        },
      ],
    );
    expect(violations).toEqual([]);
    expect(issues).toEqual([]);
  });

  it("flags an over-cap group title and summary with structured violations", () => {
    const { violations, issues } = validateTextLength(
      [group("g2", "t".repeat(151), "s".repeat(251))],
      [],
    );
    expect(violations).toEqual([
      {
        surface: "group-title",
        field: "group g2 title",
        actual: 151,
        cap: 150,
      },
      {
        surface: "group-summary",
        field: "group g2 summary",
        actual: 251,
        cap: 250,
      },
    ]);
    expect(issues).toHaveLength(2);
    expect(issues[0]).toContain("group g2 title is 151 chars");
    expect(issues[1]).toContain("exceeds the 250-char cap");
  });

  it("flags an over-cap riskNotes note per attribute and skips absent riskNotes", () => {
    const { violations } = validateTextLength(
      [],
      [
        { id: "c1" },
        {
          id: "c2",
          riskNotes: [
            { attr: "mutates-state", note: "x".repeat(201) },
            { attr: "external-io", note: "short" },
          ],
        },
      ],
    );
    expect(violations).toEqual([
      {
        surface: "risk-note",
        field: "chunk c2 riskNotes[mutates-state]",
        actual: 201,
        cap: 200,
      },
    ]);
  });
});

describe("validateNarrativeTextLength", () => {
  it("flags an over-cap overview and chunk summary, passes compliant ones", () => {
    const { violations, issues } = validateNarrativeTextLength(
      "o".repeat(251),
      [
        { id: "rc1", summary: "fine" },
        { id: "rc2", summary: "w".repeat(151) },
      ],
    );
    expect(violations).toEqual([
      {
        surface: "narrative-overview",
        field: "narrative overview",
        actual: 251,
        cap: 250,
      },
      {
        surface: "narrative-chunk-summary",
        field: "narrative chunk rc2 summary",
        actual: 151,
        cap: 150,
      },
    ]);
    expect(issues).toHaveLength(2);
  });

  it("is silent when everything fits", () => {
    const { violations, issues } = validateNarrativeTextLength("short", [
      { id: "rc1", summary: "also short" },
    ]);
    expect(violations).toEqual([]);
    expect(issues).toEqual([]);
  });
});
