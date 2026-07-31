import { describe, expect, it } from "vitest";
import {
  commentsName,
  deltaCommentsName,
  deltaDiffsName,
  deltaSummaryLines,
  diffsName,
  outName,
  summaryLines,
} from "../../src/artifacts/output";
import type { Brief, DeltaBrief } from "../../src/types";

const brief: Brief = {
  pr: {
    repo: "medusajs/medusa",
    number: 15605,
    title: "Add stock location feature",
    url: "https://github.com/medusajs/medusa/pull/15605",
    sha: "abc12300deadbeef",
    description: "Adds stock locations.",
  },
  index: 2,
  commitRange: {
    base: "base1234aaaa",
    head: "abc12300deadbeef",
    commitCount: 5,
  },
  generation: { provider: "anthropic", model: "claude-opus-4-8", effort: "medium" },
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
  baselineIndex: 1,
  headIndex: 2,
  generation: { provider: "anthropic", model: "claude-opus-4-8", effort: "medium" },
  summary: "Since you last looked, the accordion review comments were addressed.",
  commentsAddressed: "",
  changedGroups: [],
  chunks: [],
  wholePrImpact: "The follow-up narrows behavior around the original accordion work.",
};

describe("brief artifact names", () => {
  it("version the stem with index + head8 (ADR 0012)", () => {
    expect(outName(brief)).toBe("medusajs-medusa-15605_2_abc12300.brief.json");
    expect(diffsName(brief)).toBe("medusajs-medusa-15605_2_abc12300.diffs.json");
    expect(commentsName(brief)).toBe(
      "medusajs-medusa-15605_2_abc12300.comments.json",
    );
  });
});

describe("delta sidecar names", () => {
  it("builds <owner>-<repo>-<number>-<base8>..<head8>.delta.diffs.json", () => {
    expect(deltaDiffsName(delta)).toBe(
      "Idan91-components-4-35788079..a01bcf1d.delta.diffs.json",
    );
  });

  it("builds the matching .delta.comments.json sidecar", () => {
    expect(deltaCommentsName(delta)).toBe(
      "Idan91-components-4-35788079..a01bcf1d.delta.comments.json",
    );
  });
});

describe("summaryLines", () => {
  const text = summaryLines(brief).join("\n");

  it("surfaces the uncertainty between categories", () => {
    expect(text).toContain("uncertain: new-feature vs bugfix");
  });

  it("shows the brief index and commit range", () => {
    expect(text).toContain("brief _2 | base1234..abc12300, 5 commit(s)");
  });

  it("shows generation provenance", () => {
    expect(text).toContain("via anthropic/claude-opus-4-8 · effort medium");
  });

  it("lists only chunks that carry risk-surface flags", () => {
    expect(text).toContain("c1 src/module.ts [carrier]: widely-imported, no-tests");
    expect(text).toContain("flags (1/2 chunks)");
    expect(text).not.toContain("c2 src/module.test.ts");
  });
});

describe("deltaSummaryLines", () => {
  it("labels endpoints by brief index when both ends were briefed", () => {
    const text = deltaSummaryLines(delta).join("\n");
    expect(text).toContain("_1 (35788079) → _2 (a01bcf1d)");
  });

  it("falls back to the SHA when an endpoint was never briefed", () => {
    const text = deltaSummaryLines({
      ...delta,
      baselineIndex: null,
    }).join("\n");
    expect(text).toContain("35788079 → _2 (a01bcf1d)");
  });

  it("shows generation provenance", () => {
    expect(deltaSummaryLines(delta).join("\n")).toContain(
      "via anthropic/claude-opus-4-8 · effort medium",
    );
  });
});
