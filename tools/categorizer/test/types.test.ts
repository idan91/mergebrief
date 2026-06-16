import { describe, expect, it } from "vitest";
import { BriefSchema, DeltaBriefSchema } from "../src/types.js";

const validBrief = {
  pr: {
    repo: "o/r",
    number: 1,
    title: "t",
    url: "https://github.com/o/r/pull/1",
    sha: "deadbeef",
    description: "d",
  },
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
    bad.changeGroups[0]!.dominantCategory = "refactor-everything";
    expect(BriefSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects an out-of-vocabulary risk-surface attribute", () => {
    const bad = structuredClone(validBrief);
    bad.chunks[0]!.riskSurface = ["scary"];
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
    bad.changedGroups[0]!.dominantCategory = "refactor-everything";
    expect(DeltaBriefSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a delta missing wholePrImpact", () => {
    const bad = structuredClone(validDelta) as Partial<typeof validDelta>;
    delete bad.wholePrImpact;
    expect(DeltaBriefSchema.safeParse(bad).success).toBe(false);
  });
});
