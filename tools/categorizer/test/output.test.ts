import { describe, expect, it } from "vitest";
import { deltaDiffsName, outName, summaryLines } from "../src/output.js";
import type { Brief, DeltaBrief } from "../src/types.js";

const brief: Brief = {
  pr: {
    repo: "medusajs/medusa",
    number: 15605,
    title: "Add stock location feature",
    url: "https://github.com/medusajs/medusa/pull/15605",
    sha: "abc123",
    description: "Adds stock locations.",
  },
  summary: "Adds a stock-location capability.",
  changeGroups: [
    {
      id: "g1",
      title: "Add stock-location module",
      summary: "New stock-location module",
      dominantCategory: "new-feature",
      secondaryCategories: [],
      uncertain: true,
      uncertainBetween: ["new-feature", "bugfix"],
    },
  ],
  chunks: [
    {
      id: "c1",
      changeGroupId: "g1",
      file: "src/module.ts",
      concern: "implementation",
      role: "carrier",
      loc: { added: 40, deleted: 2 },
      addedRanges: [{ start: 10, end: 49 }],
      removedRanges: [{ start: 10, end: 11 }],
      riskSurface: ["widely-imported", "no-tests"],
    },
    {
      id: "c2",
      changeGroupId: "g1",
      file: "src/module.test.ts",
      concern: "test",
      role: "supporting",
      loc: { added: 30, deleted: 0 },
      addedRanges: [{ start: 1, end: 30 }],
      removedRanges: [],
      riskSurface: [],
    },
  ],
  concernView: [
    { concern: "implementation", added: 40, deleted: 2 },
    { concern: "test", added: 30, deleted: 0 },
  ],
};

const delta: DeltaBrief = {
  pr: {
    repo: "Idan91/components",
    number: 4,
    title: "feat: Add Accordion And Collapsible Components",
    url: "https://github.com/Idan91/components/pull/4",
    sha: "a01bcf1db649b18404dddc9d61b9dd1b3cc75dfd",
    description: "Adds accordion and collapsible components.",
  },
  baselineSha: "3578807971c2ddc8dc76a978f25f61e09f524941",
  headSha: "a01bcf1db649b18404dddc9d61b9dd1b3cc75dfd",
  summary: "Since you last looked, the accordion review comments were addressed.",
  commentsAddressed: "",
  changedGroups: [],
  chunks: [],
  wholePrImpact: "The follow-up narrows behavior around the original accordion work.",
};

describe("outName", () => {
  it("builds <owner>-<repo>-<number>.brief.json", () => {
    expect(outName(brief)).toBe("medusajs-medusa-15605.brief.json");
  });
});

describe("deltaDiffsName", () => {
  it("builds <owner>-<repo>-<number>-<base8>..<head8>.delta.diffs.json", () => {
    expect(deltaDiffsName(delta)).toBe(
      "Idan91-components-4-35788079..a01bcf1d.delta.diffs.json",
    );
  });
});

describe("summaryLines", () => {
  const text = summaryLines(brief).join("\n");

  it("surfaces the uncertainty between categories", () => {
    expect(text).toContain("uncertain: new-feature vs bugfix");
  });

  it("lists only chunks that carry risk-surface flags", () => {
    expect(text).toContain("c1 src/module.ts [carrier]: widely-imported, no-tests");
    expect(text).toContain("flags (1/2 chunks)");
    expect(text).not.toContain("c2 src/module.test.ts");
  });
});
