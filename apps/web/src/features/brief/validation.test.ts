import { describe, expect, it } from "vitest";

import { parseBrief, parseDeltaBrief } from "./validation";

const pr = {
  repo: "Idan91/components",
  number: 4,
  title: "feat: Add Accordion And Collapsible Components",
  url: "https://github.com/Idan91/components/pull/4",
  sha: "a01bcf1db649b18404dddc9d61b9dd1b3cc75dfd",
  description: "Adds accordion and collapsible components.",
};

const newShapeGroup = {
  id: "g1",
  title: "Typesafe open/closed state",
  summary: "Adds typed state constants and threads state through contexts.",
  dominantCategory: "logic-refactor",
  secondaryCategories: [],
  uncertain: false,
  uncertainBetween: [],
};

const newShapeChunk = {
  id: "c1",
  changeGroupId: "g1",
  file: "src/components/Accordion/Accordion.types.ts",
  concern: "implementation",
  role: "carrier",
  loc: { added: 7, deleted: 0 },
  addedRanges: [{ start: 9, end: 12 }],
  removedRanges: [],
  riskSurface: ["cross-service"],
};

describe("parseBrief", () => {
  it("accepts categorizer output with group ids and chunk changeGroupId membership", () => {
    const parsed = parseBrief({
      pr,
      summary: "Adds accordion and collapsible components.",
      changeGroups: [newShapeGroup],
      chunks: [newShapeChunk],
      concernView: [{ concern: "implementation", added: 7, deleted: 0 }],
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.changeGroups[0]?.id).toBe("g1");
    expect(parsed.value.chunks[0]?.changeGroupId).toBe("g1");
  });

  it("rejects pr urls that are not http(s)", () => {
    const parsed = parseBrief({
      pr: { ...pr, url: "javascript:alert(1)" },
      summary: "Adds accordion and collapsible components.",
      changeGroups: [newShapeGroup],
      chunks: [newShapeChunk],
      concernView: [{ concern: "implementation", added: 7, deleted: 0 }],
    });

    expect(parsed).toEqual({
      ok: false,
      error:
        "Expected pr repo, number, title, http(s) url, sha, and description",
    });
  });

  it("normalizes legacy group chunk-id arrays to chunk changeGroupId membership", () => {
    const parsed = parseBrief({
      pr,
      summary: "Adds accordion and collapsible components.",
      changeGroups: [
        {
          ...newShapeGroup,
          id: undefined,
          carrierChunkIds: ["c1"],
          supportingChunkIds: [],
        },
      ],
      chunks: [{ ...newShapeChunk, changeGroupId: undefined }],
      concernView: [{ concern: "implementation", added: 7, deleted: 0 }],
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.changeGroups[0]?.id).toBe("g1");
    expect(parsed.value.chunks[0]?.changeGroupId).toBe("g1");
  });
});

describe("parseDeltaBrief", () => {
  it("normalizes delta output into a renderable local artifact", () => {
    const parsed = parseDeltaBrief({
      pr,
      baselineSha: "3578807971c2ddc8dc76a978f25f61e09f524941",
      headSha: "a01bcf1db649b18404dddc9d61b9dd1b3cc75dfd",
      summary: "Since you last looked, typed state constants were added.",
      commentsAddressed:
        "Addresses prior comments about literal state strings.",
      reviewComments: [
        {
          id: "3419186366",
          file: "src/components/Accordion/Accordion.tsx",
          startLine: 40,
          line: 42,
          originalStartLine: 38,
          originalLine: 40,
          author: "Idan91",
          body: "Can we avoid literal state strings here?",
          inReplyToId: null,
          outdated: false,
        },
      ],
      changedGroups: [newShapeGroup],
      chunks: [
        {
          ...newShapeChunk,
          summary: "Adds AccordionStates and context state.",
          addressesComments: ["3419186366"],
        },
        {
          ...newShapeChunk,
          id: "c2",
          summary: "Updates data-state usage in the component.",
          addressesComments: [],
        },
      ],
      wholePrImpact: "The follow-up tightens the original component API.",
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.artifactKind).toBe("delta");
    expect(parsed.value.baselineSha?.slice(0, 8)).toBe("35788079");
    expect(parsed.value.concernView).toEqual([
      { concern: "implementation", added: 14, deleted: 0 },
    ]);
    expect(parsed.value.chunks[0]?.summary).toBe(
      "Adds AccordionStates and context state.",
    );
    expect(parsed.value.chunks[1]?.addressesComments).toEqual([]);
    expect(parsed.value.reviewComments?.[0]?.body).toBe(
      "Can we avoid literal state strings here?",
    );
    expect(parsed.value.reviewComments?.[0]?.startLine).toBe(40);
    expect(parsed.value.reviewComments?.[0]?.originalStartLine).toBe(38);
  });
});
