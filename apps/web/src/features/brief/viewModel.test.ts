import { describe, expect, it } from "vitest";

import { parseBrief } from "./validation";
import { buildBriefViewModel } from "./viewModel";

describe("buildBriefViewModel", () => {
  it("groups chunks by chunk.changeGroupId and derives carrier/supporting buckets", () => {
    const parsed = parseBrief({
      pr: {
        repo: "Idan91/components",
        number: 4,
        title: "feat: Add Accordion And Collapsible Components",
        url: "https://github.com/Idan91/components/pull/4",
        sha: "a01bcf1db649b18404dddc9d61b9dd1b3cc75dfd",
        description: "Adds accordion and collapsible components.",
      },
      summary: "Adds accordion and collapsible components.",
      changeGroups: [
        {
          id: "g1",
          title: "Typed state",
          summary: "Adds typed state constants.",
          dominantCategory: "logic-refactor",
          secondaryCategories: [],
          uncertain: false,
          uncertainBetween: [],
        },
      ],
      chunks: [
        {
          id: "c1",
          changeGroupId: "g1",
          file: "src/component.tsx",
          concern: "implementation",
          role: "carrier",
          loc: { added: 4, deleted: 1 },
          addedRanges: [{ start: 1, end: 4 }],
          removedRanges: [{ start: 1, end: 1 }],
          riskSurface: ["dense-logic"],
        },
        {
          id: "c2",
          changeGroupId: "g1",
          file: "src/component.test.tsx",
          concern: "test",
          role: "supporting",
          loc: { added: 8, deleted: 0 },
          addedRanges: [{ start: 1, end: 8 }],
          removedRanges: [],
          riskSurface: [],
        },
      ],
      concernView: [
        { concern: "implementation", added: 4, deleted: 1 },
        { concern: "test", added: 8, deleted: 0 },
      ],
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const model = buildBriefViewModel(parsed.value);

    expect(model.groups[0]?.chunks.map((chunk) => chunk.id)).toEqual(["c1", "c2"]);
    expect(model.groups[0]?.carrierChunks.map((chunk) => chunk.id)).toEqual(["c1"]);
    expect(model.groups[0]?.supportingChunks.map((chunk) => chunk.id)).toEqual(["c2"]);
    expect(model.chunkToGroup.get("c1")).toBe("g1");
    expect(model.flags[0]?.groupId).toBe("g1");
  });
});
