import { describe, expect, it } from "vitest";
import { BriefSchema } from "../src/types.js";

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
      title: "g title",
      summary: "g",
      dominantCategory: "bugfix",
      secondaryCategories: [],
      uncertain: false,
      uncertainBetween: [],
      carrierChunkIds: ["c1"],
      supportingChunkIds: [],
    },
  ],
  chunks: [
    {
      id: "c1",
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
