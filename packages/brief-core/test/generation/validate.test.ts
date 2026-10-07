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
import type { Chunk, IntentCheck, RiskSurfaceAttribute } from "../../src/types";

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

  it("flags chunks referencing unknown groups", () => {
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

describe("validateReadingOrder with frozen ids on anchored runs", () => {
  const emitted = [{ id: "tmp1" }];

  it("accepts an order spanning emitted + carried ids and demands BOTH", () => {
    expect(
      validateReadingOrder(
        [{ groupId: "gFrozen" }, { groupId: "tmp1" }],
        emitted,
        ["gFrozen"],
      ),
    ).toEqual([]);
    // Missing the carried id is an issue, the anchored contract demands the
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

  it("preserves fresh validation behavior without carried ids", () => {
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

  it("warns on narrative group ids missing from the current brief", () => {
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

  it("flags unknown group ids", () => {
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

  it("warns and drops uncited comment-contradicts-code while keeping chunks", () => {
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

  it("keeps new-dependency for new keys in the chunk's own added lines", () => {
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

  it("drops new-dependency for version bumps with matching removed keys", () => {
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

  it("drops new-dependency for added manifest metadata", () => {
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

  it("confirms new dependencies only within the chunk's added ranges", () => {
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

  it("preserves valid attribute notes and removes dropped attributes' notes", () => {
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

  it("accepts chunk added ranges overlapping added marks", () => {
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

  it("accepts chunk removed ranges overlapping removed marks", () => {
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

describe("validateMarksNarrativeCoverage in reverse", () => {
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

  it("flags removed ranges covered only by added-side marks", () => {
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
  const chunk: Chunk = {
    id: "c1",
    changeGroupId: "g1",
    file,
    concern: "implementation",
    role: "core",
    loc: { added: 1, deleted: 0 },
    addedRanges: [{ start: 1, end: 1 }],
    removedRanges: [],
    riskSurface,
  };

  if (withNote) {
    chunk.riskNotes = riskSurface.map((attr) => ({ attr, note: "n" }));
  }

  return chunk;
}

describe("validateRepoAttributeTokens with warn-and-drop validation", () => {
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

  it("drops out-of-scope custom firings and notes without scoping built-ins", () => {
    const { chunks, issues } = validateRepoAttributeTokens(
      [chunkWith("apps/web/p.tsx", ["touches-billing", "touches-auth"], true)],
      custom,
    );
    expect(chunks[0]?.riskSurface).toEqual(["touches-auth"]);
    expect(chunks[0]?.riskNotes?.map((n) => n.attr)).toEqual(["touches-auth"]);
    expect(issues.join("\n")).toContain("outside its path scope");
  });

  it("is pure, the input chunks are not mutated", () => {
    const input = [chunkWith("a.ts", ["invented-token"])];
    validateRepoAttributeTokens(input, custom);
    expect(input[0]?.riskSurface).toEqual(["invented-token"]);
  });
});

describe("validateRepoAttributeTokens rejects tokens smuggled through riskNotes", () => {
  const custom = [
    { name: "touches-billing", criteria: "c", paths: ["services/billing/**"] },
  ];

  it("drops unknown or out-of-scope notes even without riskSurface entries", () => {
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
    ticketTitles: ["Stop the retry loop"],
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

  /** A grounded alarm-bucket item, verifiable quote + valid group anchor. */
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

  it("empties all non-empty buckets for broad or absent specificity", () => {
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

  it("accepts already-empty broad checks without issues", () => {
    const { issues } = validateIntentCheck(
      {
        ticketUrls: [ticketUrl],
        ticketTitles: ["Stop the retry loop"],
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

  it("drops the paired title when its un-injected ticketUrl drops", () => {
    const forged = "https://evil.example/T-666";
    const input = {
      ...preciseCheck(),
      ticketUrls: [ticketUrl, forged],
      ticketTitles: ["Stop the retry loop", "Forged ticket"],
    };
    const { intentCheck } = validateIntentCheck(
      input,
      emittedGroups,
      injected,
      sources,
    );
    expect(intentCheck.ticketUrls).toEqual([ticketUrl]);
    expect(intentCheck.ticketTitles).toEqual(["Stop the retry loop"]);
  });

  it("warns and pads or truncates titles to match URL counts", () => {
    const short = { ...preciseCheck(), ticketTitles: [] };
    const padded = validateIntentCheck(short, emittedGroups, injected, sources);
    expect(padded.intentCheck.ticketTitles).toEqual([""]);
    expect(padded.issues.join("\n")).toContain("ticketTitles");

    const long = {
      ...preciseCheck(),
      ticketTitles: ["Stop the retry loop", "stray extra title"],
    };
    const truncated = validateIntentCheck(
      long,
      emittedGroups,
      injected,
      sources,
    );
    expect(truncated.intentCheck.ticketTitles).toEqual(["Stop the retry loop"]);
    expect(truncated.issues.join("\n")).toContain("ticketTitles");
  });

  it("keeps titles paired with surviving urls on the broad/none path too", () => {
    const forged = "https://evil.example/T-666";
    const { intentCheck } = validateIntentCheck(
      {
        ...preciseCheck(),
        specificity: "broad",
        accomplished: [],
        statedButMissing: [],
        doneButUnstated: [],
        deviations: [],
        claimedButUnachieved: [],
        ticketUrls: [forged, ticketUrl],
        ticketTitles: ["Forged ticket", "Stop the retry loop"],
      },
      emittedGroups,
      injected,
      sources,
    );
    expect(intentCheck.ticketUrls).toEqual([ticketUrl]);
    expect(intentCheck.ticketTitles).toEqual(["Stop the retry loop"]);
  });

  it("accepts empty sourceUrl for title/body without ticket membership", () => {
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

  it("warns but keeps accomplished asks after all dangling group ids drop", () => {
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

  it("warns but keeps accomplished asks emitted without group ids", () => {
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

  it("drops unstated items when every group id dangles", () => {
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

  it("warns and clears group ids from statedButMissing items", () => {
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

  it("warns but keeps quotes that fail source-substring verification", () => {
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

  it("normalizes line breaks and repeated spaces before checking substrings", () => {
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

  it("warns on empty quotes for ticket-side asks", () => {
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

  it("allows unstated items to have empty quotes without warning", () => {
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

  it("is pure, the input intent check is not mutated", () => {
    const input = { ...preciseCheck(), specificity: "broad" as const };
    validateIntentCheck(input, emittedGroups, injected, sources);
    expect(input.accomplished).toHaveLength(1);
  });

  describe("alarm buckets, drop, never warn-and-keep", () => {
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
        // "must stop" IS a substring of the ticket content, length, not
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

    it("preserves acknowledged deviations", () => {
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

    it("warns and clears acknowledged outside deviation buckets", () => {
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

/** One tagged wire item, the shape generation actually emits. */
const genItem = (bucket: string, intent: string, overrides = {}) => ({
  bucket,
  intent,
  quote: "q",
  sourceUrl: "",
  groupIds: ["g1"],
  acknowledged: false,
  ...overrides,
});

describe("fanOutIntentCheck within the grammar budget", () => {
  it("dispatches each tagged item into its stored bucket and drops the tag", () => {
    const out = fanOutIntentCheck({
      ticketUrls: ["https://tracker.example/T-1"],
      ticketTitles: ["Stop the retry loop"],
      specificity: "precise",
      scopeNote: "note",
      items: [
        genItem("accomplished", "did the thing"),
        genItem("statedButMissing", "missed the thing"),
        genItem("doneButUnstated", "extra thing"),
        genItem("deviations", "opposed the thing", { acknowledged: true }),
        genItem("claimedButUnachieved", "masked the thing"),
      ],
      alignment: { read: "", goal: "", response: "" },
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
    // The bucket tag is wire framing, it never reaches the stored artifact.
    expect(out.accomplished[0]).not.toHaveProperty("bucket");
    expect(out.deviations[0]?.acknowledged).toBe(true);
    // Scalars ride through untouched.
    expect(out.ticketUrls).toEqual(["https://tracker.example/T-1"]);
    expect(out.ticketTitles).toEqual(["Stop the retry loop"]);
    expect(out.specificity).toBe("precise");
    expect(out.scopeNote).toBe("note");
  });

  it("preserves order within a bucket and keeps multiple items per bucket", () => {
    const out = fanOutIntentCheck({
      ticketUrls: [],
      ticketTitles: [],
      specificity: "precise",
      scopeNote: "",
      items: [
        genItem("accomplished", "first"),
        genItem("deviations", "dev"),
        genItem("accomplished", "second"),
      ],
      alignment: { read: "", goal: "", response: "" },
    });
    expect(out.accomplished.map((i) => i.intent)).toEqual(["first", "second"]);
    expect(out.deviations).toHaveLength(1);
  });

  it("returns five empty buckets for empty tagged items", () => {
    const out = fanOutIntentCheck({
      ticketUrls: [],
      ticketTitles: [],
      specificity: "none",
      scopeNote: "",
      items: [],
      alignment: { read: "", goal: "", response: "" },
    });
    expect(out.accomplished).toEqual([]);
    expect(out.statedButMissing).toEqual([]);
    expect(out.doneButUnstated).toEqual([]);
    expect(out.deviations).toEqual([]);
    expect(out.claimedButUnachieved).toEqual([]);
  });

  it("validates dispatched tagged items like native bucket arrays", () => {
    const fanned = fanOutIntentCheck({
      ticketUrls: [],
      ticketTitles: [],
      specificity: "precise",
      scopeNote: "",
      items: [
        // Alarm item with an unverifiable quote, the validator must still drop it.
        genItem("deviations", "ungrounded alarm", {
          quote: "this ask appears nowhere in the sources",
        }),
      ],
      alignment: { read: "", goal: "", response: "" },
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

describe("validateTextLength with warn-only limits", () => {
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

  it("flags oversized attribute notes and skips absent riskNotes", () => {
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

describe("validateIntentCheck, the alignment read", () => {
  const anchorGroups = [{ id: "g1" }];
  const primaryUrl = "https://github.com/o/r/issues/7";
  const primaryText =
    "Retry loop\n\nThe retry loop must stop after three attempts and surface the last error.";
  const sources = [
    { url: "", content: "Fix retry loop\n\nfixes #7" },
    { url: primaryUrl, content: primaryText },
  ];
  const alignment = {
    read: "partial" as const,
    goal: "The retry loop must stop after three attempts and surface the last error.",
    response: "Stops after three attempts; the last error is still swallowed.",
  };
  const makeIntentCheck = (
    overrides: Partial<IntentCheck> = {},
  ): IntentCheck => ({
    ticketUrls: [primaryUrl],
    ticketTitles: ["Retry loop"],
    specificity: "precise",
    scopeNote: "",
    accomplished: [],
    statedButMissing: [],
    doneButUnstated: [],
    deviations: [],
    claimedButUnachieved: [],
    alignment,
    ...overrides,
  });
  const readPrimary = { url: primaryUrl, read: true };

  it("keeps reads with goals verified against normalized primary text", () => {
    const spaced = {
      ...alignment,
      goal: "The retry loop   must stop after three\nattempts and surface the last error.",
    };
    const result = validateIntentCheck(
      makeIntentCheck({ alignment: spaced }),
      anchorGroups,
      [primaryUrl],
      sources,
      [],
      readPrimary,
    );
    expect(result.intentCheck.alignment).toEqual(spaced);
    expect(result.issues).toEqual([]);
  });

  it("keeps a three-word goal, ticket goals run shorter than alarm quotes", () => {
    const short = { ...alignment, goal: "The retry loop" };
    const result = validateIntentCheck(
      makeIntentCheck({ alignment: short }),
      anchorGroups,
      [primaryUrl],
      sources,
      [],
      readPrimary,
    );
    expect(result.intentCheck.alignment).toEqual(short);
    expect(result.issues).toEqual([]);
  });

  it.each([
    ["an empty goal", { ...alignment, goal: "" }, readPrimary],
    [
      "a goal under three words",
      { ...alignment, goal: "Retry loop" },
      readPrimary,
    ],
    [
      "a goal not in the primary",
      { ...alignment, goal: "the retry loop should log every attempt to disk" },
      readPrimary,
    ],
    ["an unread primary", alignment, { url: primaryUrl, read: false }],
    ["no primary at all", alignment, undefined],
  ])(
    "drops the read whole for %s, with one warning",
    (_label, value, primary) => {
      const result = validateIntentCheck(
        makeIntentCheck({ alignment: value }),
        groups,
        [primaryUrl],
        sources,
        [],
        primary,
      );
      expect(result.intentCheck.alignment).toBeUndefined();
      expect(result.issues.filter((i) => i.includes("alignment"))).toHaveLength(
        1,
      );
    },
  );

  it("omits reads when specificity is broad or absent", () => {
    for (const specificity of ["broad", "none"] as const) {
      const result = validateIntentCheck(
        makeIntentCheck({ specificity }),
        groups,
        [primaryUrl],
        sources,
        [],
        readPrimary,
      );
      expect(result.intentCheck.alignment).toBeUndefined();
      expect(result.issues.some((i) => i.includes("alignment"))).toBe(true);
    }
  });

  it("is silent when the model emitted no read", () => {
    const result = validateIntentCheck(
      makeIntentCheck({ alignment: undefined }),
      anchorGroups,
      [primaryUrl],
      sources,
      [],
      readPrimary,
    );
    expect(result.intentCheck.alignment).toBeUndefined();
    expect(result.issues).toEqual([]);
  });
});

describe("fanOutIntentCheck, the alignment sentinel", () => {
  const base = {
    ticketUrls: [],
    ticketTitles: [],
    specificity: "precise" as const,
    scopeNote: "",
    items: [],
    alignment: { read: "", goal: "", response: "" },
  };

  it('turns read "" into absence', () => {
    const out = fanOutIntentCheck({
      ...base,
      alignment: { read: "", goal: "", response: "" },
    });
    expect("alignment" in out).toBe(false);
  });

  it("carries a real read through", () => {
    const out = fanOutIntentCheck({
      ...base,
      alignment: { read: "aligned", goal: "g", response: "r" },
    });
    expect(out.alignment).toEqual({
      read: "aligned",
      goal: "g",
      response: "r",
    });
  });
});
