import { describe, expect, it } from "vitest";
import { createI18n } from "i18n";

import type { DiffLine } from "../../brief/types";
import {
  buildSuggestionDiffRows,
  commentAnchorLabel,
  createCommentAnchor,
  MAX_POSTED_COMMENT_LENGTH,
  postCommentBlockedReason,
  reviewCommentSubmitLabel,
} from "./comments";

const diffRows: DiffLine[] = [
  { kind: "hunk", content: "@@ -10,4 +10,5 @@" },
  { kind: "ctx", content: "const before = true;", oldLine: 10, newLine: 10 },
  { kind: "del", content: "const label = 'old';", oldLine: 11 },
  { kind: "add", content: "const label = 'new';", newLine: 11 },
  { kind: "add", content: "const enabled = true;", newLine: 12 },
  { kind: "ctx", content: "export { label };", oldLine: 12, newLine: 13 },
];
const t = createI18n().t;

describe("createCommentAnchor", () => {
  it("anchors a single added line", () => {
    expect(createCommentAnchor("chunk-1", "src/a.ts", diffRows, [3])).toEqual({
      chunkId: "chunk-1",
      file: "src/a.ts",
      side: "new",
      startLine: 11,
      endLine: 11,
      rowIds: ["chunk-1:3"],
      selectedText: "const label = 'new';",
    });
  });

  it("anchors continuous new-side ranges across added and context rows", () => {
    expect(
      createCommentAnchor("chunk-1", "src/a.ts", diffRows, [3, 4, 5]),
    ).toMatchObject({
      side: "new",
      startLine: 11,
      endLine: 13,
      selectedText:
        "const label = 'new';\nconst enabled = true;\nexport { label };",
    });
  });

  it("rejects hunk rows", () => {
    expect(
      createCommentAnchor("chunk-1", "src/a.ts", diffRows, [0]),
    ).toBeNull();
  });

  it("anchors a mixed selection across sides — del start, add end", () => {
    expect(
      createCommentAnchor("chunk-1", "src/a.ts", diffRows, [2, 3]),
    ).toEqual({
      chunkId: "chunk-1",
      file: "src/a.ts",
      side: "new",
      startSide: "old",
      startLine: 11,
      endLine: 11,
      rowIds: ["chunk-1:2", "chunk-1:3"],
      selectedText: "const label = 'old';\nconst label = 'new';",
    });
  });

  it("collapses ctx-bounded selections to single-side, dels in between", () => {
    // Endpoints agree on the new side; the removed row rides along in the
    // selection without forcing a cross-side anchor.
    expect(
      createCommentAnchor("chunk-1", "src/a.ts", diffRows, [1, 2, 3, 4, 5]),
    ).toMatchObject({
      side: "new",
      startLine: 10,
      endLine: 13,
    });
    expect(
      createCommentAnchor("chunk-1", "src/a.ts", diffRows, [1, 2, 3, 4, 5]),
    ).not.toHaveProperty("startSide");
  });

  it("anchors a mixed selection ending on the old side", () => {
    expect(
      createCommentAnchor("chunk-1", "src/a.ts", diffRows, [1, 2]),
    ).toMatchObject({
      side: "old",
      startSide: "new",
      startLine: 10,
      endLine: 11,
    });
  });
});

describe("buildSuggestionDiffRows", () => {
  it("suppresses gutter numbers on a crossing anchor", () => {
    const rows = buildSuggestionDiffRows(
      {
        chunkId: "chunk-1",
        file: "src/a.ts",
        side: "new",
        startSide: "old",
        startLine: 11,
        endLine: 13,
        rowIds: [],
        selectedText: "a\nb",
      },
      "c",
    );
    expect(
      rows.every((row) => !("oldLine" in row) && !("newLine" in row)),
    ).toBe(true);
  });

  it("renders suggestion previews with diff gutters anchored to the selected lines", () => {
    expect(
      buildSuggestionDiffRows(
        {
          chunkId: "chunk-1",
          file: "src/a.ts",
          side: "new",
          startLine: 21,
          endLine: 22,
          rowIds: ["chunk-1:3", "chunk-1:4"],
          selectedText: "const label = 'old';\nreturn label;",
        },
        "const label = 'new';\nreturn label.trim();",
      ),
    ).toEqual([
      { kind: "del", newLine: 21, content: "const label = 'old';" },
      { kind: "del", newLine: 22, content: "return label;" },
      { kind: "add", newLine: 21, content: "const label = 'new';" },
      { kind: "add", newLine: 22, content: "return label.trim();" },
    ]);
  });
});

describe("reviewCommentSubmitLabel", () => {
  it("uses GitHub's start-review label for the first draft comment only", () => {
    expect(reviewCommentSubmitLabel(t, 0)).toBe("Start review");
    expect(reviewCommentSubmitLabel(t, 1)).toBe("Add review comment");
  });
});

describe("postCommentBlockedReason", () => {
  it("renders recoverable route-cap failures through the catalog", () => {
    const comment = {
      anchor: {
        chunkId: "c1",
        file: "src/a.ts",
        side: "new" as const,
        startLine: 1,
        endLine: 1,
        rowIds: [],
        selectedText: "",
      },
      body: "x".repeat(MAX_POSTED_COMMENT_LENGTH + 1),
    };

    expect(postCommentBlockedReason(t, comment)).toMatch(
      /65,536-character limit/i,
    );
  });
});

describe("commentAnchorLabel", () => {
  it("includes the file and selected line range", () => {
    expect(
      commentAnchorLabel(t, {
        chunkId: "c1",
        file: "src/a.ts",
        side: "new",
        startLine: 11,
        endLine: 13,
        rowIds: [],
        selectedText: "",
      }),
    ).toBe("src/a.ts · +11-13");
    expect(
      commentAnchorLabel(t, {
        chunkId: "c1",
        file: "src/a.ts",
        side: "old",
        startLine: 7,
        endLine: 7,
        rowIds: [],
        selectedText: "",
      }),
    ).toBe("src/a.ts · -7");
  });

  it("spells both signs on a range that crosses sides", () => {
    expect(
      commentAnchorLabel(t, {
        chunkId: "c1",
        file: "src/a.ts",
        side: "new",
        startSide: "old",
        startLine: 10,
        endLine: 12,
        rowIds: [],
        selectedText: "",
      }),
    ).toBe("src/a.ts · -10 → +12");
    expect(
      commentAnchorLabel(t, {
        chunkId: "c1",
        file: "src/a.ts",
        side: "old",
        startSide: "new",
        startLine: 10,
        endLine: 20,
        rowIds: [],
        selectedText: "",
      }),
    ).toBe("src/a.ts · +10 → -20");
  });
});
