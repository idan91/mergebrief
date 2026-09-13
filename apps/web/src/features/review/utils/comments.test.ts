import type { DiffLine } from "@web/utils/diffTokens/types";
import { describe, expect, it } from "vitest";
import { createI18n } from "i18n";
import { CommentAnchorKinds } from "types";

import {
  buildSuggestionDiffRows,
  commentAnchorLabel,
  resolveJumpChunkId,
  createCommentAnchor,
  createFileCommentAnchor,
  createSideAnchor,
  MAX_POSTED_COMMENT_LENGTH,
  postCommentBlockedReason,
  reviewCommentSubmitLabel,
  CommentSides,
  ReviewCommentStatuses,
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
      kind: CommentAnchorKinds.LINE,
      chunkId: "chunk-1",
      file: "src/a.ts",
      side: CommentSides.NEW,
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
      side: CommentSides.NEW,
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

  it("anchors a mixed selection across sides, del start and add end", () => {
    expect(
      createCommentAnchor("chunk-1", "src/a.ts", diffRows, [2, 3]),
    ).toEqual({
      kind: CommentAnchorKinds.LINE,
      chunkId: "chunk-1",
      file: "src/a.ts",
      side: CommentSides.NEW,
      startSide: CommentSides.OLD,
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
      side: CommentSides.NEW,
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
      side: CommentSides.OLD,
      startSide: CommentSides.NEW,
      startLine: 10,
      endLine: 11,
    });
  });
});

describe("createSideAnchor", () => {
  const twoHunks: DiffLine[] = [
    ...diffRows,
    { kind: "hunk", content: "@@ -40,2 +41,2 @@" },
    { kind: "ctx", content: "tail", oldLine: 40, newLine: 41 },
  ];

  it("anchors a same-side run on that side's numbers", () => {
    expect(
      createSideAnchor(
        "chunk-1",
        "src/a.ts",
        diffRows,
        [1, 2],
        CommentSides.OLD,
      ),
    ).toMatchObject({ side: CommentSides.OLD, startLine: 10, endLine: 11 });
    expect(
      createSideAnchor(
        "chunk-1",
        "src/a.ts",
        diffRows,
        [1, 2],
        CommentSides.OLD,
      ),
    ).not.toHaveProperty("startSide");
  });

  it("rejects a run that crosses a hunk header", () => {
    expect(
      createSideAnchor(
        "chunk-1",
        "src/a.ts",
        twoHunks,
        [5, 6, 7],
        CommentSides.NEW,
      ),
    ).toBeNull();
  });

  it("rejects a gap in the side's numbering", () => {
    expect(
      createSideAnchor(
        "chunk-1",
        "src/a.ts",
        diffRows,
        [1, 5],
        CommentSides.NEW,
      ),
    ).toBeNull();
  });

  it("rejects a row with no number on the side", () => {
    expect(
      createSideAnchor(
        "chunk-1",
        "src/a.ts",
        diffRows,
        [2, 3],
        CommentSides.OLD,
      ),
    ).toBeNull();
  });
});

describe("createFileCommentAnchor", () => {
  it("names the path only and invents no chunk or line", () => {
    expect(createFileCommentAnchor("src/a.ts")).toEqual({
      kind: CommentAnchorKinds.FILE,
      file: "src/a.ts",
    });
  });
});

describe("buildSuggestionDiffRows", () => {
  it("suppresses gutter numbers on a crossing anchor", () => {
    const rows = buildSuggestionDiffRows(
      {
        kind: CommentAnchorKinds.LINE,
        chunkId: "chunk-1",
        file: "src/a.ts",
        side: CommentSides.NEW,
        startSide: CommentSides.OLD,
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

  it("renders suggestion previews with gutters on the selected lines", () => {
    expect(
      buildSuggestionDiffRows(
        {
          kind: CommentAnchorKinds.LINE,
          chunkId: "chunk-1",
          file: "src/a.ts",
          side: CommentSides.NEW,
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

  it("builds no suggestion rows for a file comment", () => {
    expect(
      buildSuggestionDiffRows(createFileCommentAnchor("src/a.ts"), "c"),
    ).toEqual([]);
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
        kind: CommentAnchorKinds.LINE,
        chunkId: "c1",
        file: "src/a.ts",
        side: CommentSides.NEW,
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
        kind: CommentAnchorKinds.LINE,
        chunkId: "c1",
        file: "src/a.ts",
        side: CommentSides.NEW,
        startLine: 11,
        endLine: 13,
        rowIds: [],
        selectedText: "",
      }),
    ).toBe("src/a.ts · +11-13");
    expect(
      commentAnchorLabel(t, {
        kind: CommentAnchorKinds.LINE,
        chunkId: "c1",
        file: "src/a.ts",
        side: CommentSides.OLD,
        startLine: 7,
        endLine: 7,
        rowIds: [],
        selectedText: "",
      }),
    ).toBe("src/a.ts · -7");
  });

  it("labels a file anchor as a comment on the file", () => {
    expect(commentAnchorLabel(t, createFileCommentAnchor("src/a.ts"))).toBe(
      "Add comment on file",
    );
  });

  it("spells both signs on a range that crosses sides", () => {
    expect(
      commentAnchorLabel(t, {
        kind: CommentAnchorKinds.LINE,
        chunkId: "c1",
        file: "src/a.ts",
        side: CommentSides.NEW,
        startSide: CommentSides.OLD,
        startLine: 10,
        endLine: 12,
        rowIds: [],
        selectedText: "",
      }),
    ).toBe("src/a.ts · -10 → +12");
    expect(
      commentAnchorLabel(t, {
        kind: CommentAnchorKinds.LINE,
        chunkId: "c1",
        file: "src/a.ts",
        side: CommentSides.OLD,
        startSide: CommentSides.NEW,
        startLine: 10,
        endLine: 20,
        rowIds: [],
        selectedText: "",
      }),
    ).toBe("src/a.ts · +10 → -20");
  });
});

describe("resolveJumpChunkId", () => {
  it("returns the line comment's own chunk id", () => {
    expect(
      resolveJumpChunkId(
        {
          id: "c1",
          anchor: {
            kind: CommentAnchorKinds.LINE,
            chunkId: "chunk-1",
            file: "src/a.ts",
            side: CommentSides.NEW,
            startLine: 11,
            endLine: 11,
            rowIds: [],
            selectedText: "",
          },
          body: "note",
          status: ReviewCommentStatuses.DRAFT,
          collapsed: false,
        },
        [{ id: "other", file: "src/a.ts" }],
      ),
    ).toBe("chunk-1");
  });

  it("returns the first brief chunk for a file comment path", () => {
    expect(
      resolveJumpChunkId(
        {
          id: "c1",
          anchor: createFileCommentAnchor("src/a.ts"),
          body: "note",
          status: ReviewCommentStatuses.DRAFT,
          collapsed: false,
        },
        [
          { id: "first", file: "src/a.ts" },
          { id: "second", file: "src/a.ts" },
        ],
      ),
    ).toBe("first");
  });

  it("returns empty when the file is not in the brief", () => {
    expect(
      resolveJumpChunkId(
        {
          id: "c1",
          anchor: createFileCommentAnchor("gone.ts"),
          body: "note",
          status: ReviewCommentStatuses.DRAFT,
          collapsed: false,
        },
        [{ id: "first", file: "src/a.ts" }],
      ),
    ).toBe("");
  });
});
