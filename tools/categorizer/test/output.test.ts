import { describe, expect, it } from "vitest";
import { outName, summaryLines } from "../src/output.js";
import type { Brief } from "../src/types.js";

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
      title: "Add stock-location module",
      summary: "New stock-location module",
      dominantCategory: "new-feature",
      secondaryCategories: [],
      uncertain: true,
      uncertainBetween: ["new-feature", "bugfix"],
      carrierChunkIds: ["c1"],
      supportingChunkIds: ["c2"],
    },
  ],
  chunks: [
    {
      id: "c1",
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

describe("outName", () => {
  it("builds <owner>-<repo>-<number>.brief.json", () => {
    expect(outName(brief)).toBe("medusajs-medusa-15605.brief.json");
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
