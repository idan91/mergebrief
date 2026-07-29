import { describe, expect, it } from "vitest";

import type { DiffLine } from "../../brief/types";
import {
  buildSuggestionDiffRows,
  commentAnchorLabel,
  createCommentAnchor,
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

  it("rejects hunk rows and mixed old/new selections", () => {
    expect(
      createCommentAnchor("chunk-1", "src/a.ts", diffRows, [0]),
    ).toBeNull();
    expect(
      createCommentAnchor("chunk-1", "src/a.ts", diffRows, [2, 3]),
    ).toBeNull();
  });
});

describe("buildSuggestionDiffRows", () => {
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
    expect(reviewCommentSubmitLabel(0)).toBe("Start review");
    expect(reviewCommentSubmitLabel(1)).toBe("Add review comment");
  });
});

describe("commentAnchorLabel", () => {
  it("includes the file and selected line range", () => {
    expect(
      commentAnchorLabel({
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
      commentAnchorLabel({
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
});
