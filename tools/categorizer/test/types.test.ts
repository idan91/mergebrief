import { describe, expect, it } from "vitest";
import { enumPreservingJsonSchema } from "generators";
import {
  BriefGenerationSchema,
  BriefSchema,
  briefGenerationSchemaWith,
  DeltaBriefSchema,
  RevisionNarrativeSchema,
} from "../src/types";

const validBrief = {
  pr: {
    repo: "o/r",
    number: 1,
    title: "t",
    url: "https://github.com/o/r/pull/1",
    sha: "deadbeef",
    description: "d",
  },
  index: 1,
  commitRange: { base: "base0000", head: "deadbeef", commitCount: 2 },
  generation: { provider: "anthropic", model: "claude-opus-4-8", effort: "medium" },
  summary: "s",
  changeGroups: [
    {
      id: "g1",
      title: "g title",
      summary: "g",
      dominantCategory: "bugfix",
      secondaryCategories: [],
      uncertain: false,
      uncertainBetween: [],
    },
  ],
  chunks: [
    {
      id: "c1",
      changeGroupId: "g1",
      file: "a.ts",
      concern: "implementation",
      role: "carrier",
      loc: { added: 1, deleted: 0 },
      addedRanges: [{ start: 5, end: 5 }],
      removedRanges: [],
      riskSurface: ["mutates-state"],
    },
  ],
  concernView: [{ concern: "implementation", added: 1, deleted: 0 }],
};

describe("BriefSchema", () => {
  it("accepts a well-formed brief", () => {
    expect(BriefSchema.safeParse(validBrief).success).toBe(true);
  });

  it("rejects an out-of-vocabulary category", () => {
    const bad = structuredClone(validBrief);
    bad.changeGroups[0].dominantCategory = "refactor-everything";
    expect(BriefSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects an out-of-vocabulary risk-surface attribute", () => {
    const bad = structuredClone(validBrief);
    bad.chunks[0].riskSurface = ["scary"];
    expect(BriefSchema.safeParse(bad).success).toBe(false);
  });

  it("accepts the trio attributes with a riskNotes entry", () => {
    const withNotes = structuredClone(validBrief);
    withNotes.chunks[0].riskSurface = [
      "new-dependency",
      "new-abstraction",
      "comment-contradicts-code",
    ];
    Object.assign(withNotes.chunks[0], {
      riskNotes: [
        {
          attr: "comment-contradicts-code",
          note: "comment says retries 3 times (L12), code retries once (L15)",
        },
      ],
    });
    expect(BriefSchema.safeParse(withNotes).success).toBe(true);
  });

  it("accepts a chunk without riskNotes (field optional; old artifacts parse)", () => {
    const parsed = BriefSchema.safeParse(structuredClone(validBrief));
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.chunks[0].riskNotes).toBeUndefined();
  });

  it("rejects a riskNotes entry with an out-of-vocabulary attr", () => {
    const bad = structuredClone(validBrief);
    Object.assign(bad.chunks[0], {
      riskNotes: [{ attr: "scary", note: "n" }],
    });
    expect(BriefSchema.safeParse(bad).success).toBe(false);
  });

  it("accepts a well-formed readingOrder", () => {
    const withOrder = {
      ...structuredClone(validBrief),
      readingOrder: [{ groupId: "g1", why: "establishes the schema the rest builds on" }],
    };
    expect(BriefSchema.safeParse(withOrder).success).toBe(true);
  });

  it("accepts the absence of readingOrder", () => {
    const withoutOrder = structuredClone(validBrief) as Partial<typeof validBrief>;
    expect("readingOrder" in withoutOrder).toBe(false);
    expect(BriefSchema.safeParse(withoutOrder).success).toBe(true);
  });

  it("rejects a malformed readingOrder step (missing why)", () => {
    const bad = {
      ...structuredClone(validBrief),
      readingOrder: [{ groupId: "g1" }],
    };
    expect(BriefSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a readingOrder step with an unexpected field shape (why not a string)", () => {
    const bad = {
      ...structuredClone(validBrief),
      readingOrder: [{ groupId: "g1", why: 123 }],
    };
    expect(BriefSchema.safeParse(bad).success).toBe(false);
  });
});

const validDelta = {
  pr: {
    repo: "o/r",
    number: 1,
    title: "t",
    url: "https://github.com/o/r/pull/1",
    sha: "deadbeef",
    description: "d",
  },
  baselineSha: "1111111",
  headSha: "2222222",
  baselineIndex: 1,
  headIndex: 2,
  generation: { provider: "anthropic", model: "claude-opus-4-8", effort: "medium" },
  summary: "since you last looked, the author added a test",
  commentsAddressed: "addresses the reviewer's request to add a test",
  changedGroups: [
    {
      id: "g1",
      title: "g title",
      summary: "g",
      dominantCategory: "bugfix",
      secondaryCategories: [],
      uncertain: false,
      uncertainBetween: [],
    },
  ],
  chunks: [
    {
      id: "c1",
      changeGroupId: "g1",
      file: "a.ts",
      concern: "implementation",
      role: "carrier",
      loc: { added: 1, deleted: 0 },
      addedRanges: [{ start: 5, end: 5 }],
      removedRanges: [],
      riskSurface: ["mutates-state"],
      summary: "adds a unit test for the fix",
      addressesComments: ["101"],
    },
  ],
  wholePrImpact: "completes the original intent",
};

describe("DeltaBriefSchema", () => {
  it("accepts a well-formed delta", () => {
    expect(DeltaBriefSchema.safeParse(validDelta).success).toBe(true);
  });

  it("rejects an out-of-vocabulary category in a changed group", () => {
    const bad = structuredClone(validDelta);
    bad.changedGroups[0].dominantCategory = "refactor-everything";
    expect(DeltaBriefSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a delta missing wholePrImpact", () => {
    const bad = structuredClone(validDelta) as Partial<typeof validDelta>;
    delete bad.wholePrImpact;
    expect(DeltaBriefSchema.safeParse(bad).success).toBe(false);
  });
});

const validRevisionNarrative = {
  artifactKind: "revisionNarrative",
  pr: {
    repo: "o/r",
    number: 1,
    title: "t",
    url: "https://github.com/o/r/pull/1",
    sha: "head0000",
    description: "d",
  },
  prevHeadSha: "prev00000",
  headSha: "head0000",
  prevIndex: 1,
  headIndex: 2,
  generation: { provider: "anthropic", model: "claude-opus-4-8", effort: "medium" },
  overview: "This revision tightens error handling around the new module.",
  chunks: [
    {
      id: "rc1",
      briefChangeGroupId: "g1",
      file: "a.ts",
      addedRanges: [{ start: 5, end: 6 }],
      removedRanges: [],
      summary: "Adds a guard clause for the empty-input case.",
    },
  ],
};

describe("RevisionNarrativeSchema", () => {
  it("accepts a well-formed revision narrative", () => {
    expect(RevisionNarrativeSchema.safeParse(validRevisionNarrative).success).toBe(true);
  });

  it("rejects an invented top-level field (e.g. the excluded Delta-only wholePrImpact)", () => {
    const bad = { ...structuredClone(validRevisionNarrative), wholePrImpact: "sneaked in" };
    expect(RevisionNarrativeSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a narrative missing overview", () => {
    const bad = structuredClone(validRevisionNarrative) as Partial<typeof validRevisionNarrative>;
    delete bad.overview;
    expect(RevisionNarrativeSchema.safeParse(bad).success).toBe(false);
  });
});

describe("ReviewCommentSchema", () => {
  it("accepts GitHub-style range anchors", async () => {
    const { ReviewCommentSchema } = await import("../src/types.js");
    const parsed = ReviewCommentSchema.safeParse({
      id: "101",
      file: "src/a.ts",
      startLine: 10,
      line: 12,
      originalStartLine: 8,
      originalLine: 10,
      author: "reviewer",
      body: "Could we cover this range?",
      inReplyToId: null,
      outdated: false,
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.startLine).toBe(10);
    expect(parsed.data.originalStartLine).toBe(8);
  });
});

const chunk = (riskSurface: string[]) => ({
  id: "c1",
  changeGroupId: "g1",
  file: "services/billing/invoice.ts",
  concern: "implementation",
  role: "carrier",
  loc: { added: 1, deleted: 0 },
  addedRanges: [{ start: 1, end: 1 }],
  removedRanges: [],
  riskSurface,
});
const briefGen = (riskSurface: string[]) => ({
  summary: "s",
  changeGroups: [
    {
      id: "g1",
      title: "t",
      summary: "s",
      dominantCategory: "new-feature",
      secondaryCategories: [],
      uncertain: false,
      uncertainBetween: [],
    },
  ],
  chunks: [chunk(riskSurface)],
  concernView: [{ concern: "implementation", added: 1, deleted: 0 }],
});

describe("briefGenerationSchemaWith (ADR 0032 #11 — per-generation vocabulary)", () => {


  it("returns the exact static schema when no custom names exist", () => {
    expect(briefGenerationSchemaWith([])).toBe(BriefGenerationSchema);
  });

  it("accepts an injected custom name alongside built-ins", () => {
    const schema = briefGenerationSchemaWith(["touches-billing"]);
    const parsed = schema.safeParse(briefGen(["touches-auth", "touches-billing"]));
    expect(parsed.success).toBe(true);
  });

  it("rejects a token that is neither built-in nor injected (closed vocabulary holds)", () => {
    const schema = briefGenerationSchemaWith(["touches-billing"]);
    expect(schema.safeParse(briefGen(["not-a-thing"])).success).toBe(false);
    // The static schema rejects the custom name too — the extension is per-generation.
    expect(BriefGenerationSchema.safeParse(briefGen(["touches-billing"])).success).toBe(false);
  });

  it("carries injected names into the enum-preserving json_schema (server-side enforcement)", () => {
    const wire = JSON.stringify(enumPreservingJsonSchema(briefGenerationSchemaWith(["touches-billing"])));
    expect(wire).toContain('"touches-billing"');
    expect(wire).toContain('"touches-auth"');
    // And the base schema's wire form does NOT know the custom name.
    const baseWire = JSON.stringify(enumPreservingJsonSchema(briefGenerationSchemaWith([])));
    expect(baseWire).not.toContain('"touches-billing"');
  });
});
