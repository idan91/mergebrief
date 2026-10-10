import { describe, expect, it } from "vitest";

import { Concerns, Roles } from "brief-core/types";
import {
  DiffLineKinds,
  DiffRowOrigins,
  type DiffLine,
} from "@web/utils/diffTokens/types";
import {
  getDiffRowView,
  isCommentableLine,
  type DiffRowViewParams,
} from "./diff-row-view";
import { type BriefChunk } from "../../../../model/types";

function stubChunk(diff: DiffLine[]): BriefChunk {
  return {
    id: "chunk-1",
    changeGroupId: "group-1",
    file: "src/a.ts",
    concern: Concerns.IMPLEMENTATION,
    role: Roles.CORE,
    loc: { added: 1, deleted: 0 },
    addedRanges: [{ start: 10, end: 10 }],
    removedRanges: [],
    riskSurface: [],
    diff,
  };
}

function stubParams(line: DiffLine): DiffRowViewParams {
  const chunk = stubChunk([line]);
  return {
    line,
    index: 0,
    chunk,
    overlayActive: false,
    comparisonView: { runByRow: new Map(), marks: new Map(), runs: [] },
    comments: [],
    addressedComments: [],
    dragIndexes: new Set(),
    activeRowIds: new Set(),
    activeCommentAnchor: null,
    strandedRowIds: new Map(),
  };
}

describe("getDiffRowView", () => {
  it("refuses comments on a row read from the file, not the diff", () => {
    const view = getDiffRowView(
      stubParams({
        kind: DiffLineKinds.CTX,
        origin: DiffRowOrigins.EXPANDED,
        content: "const a = 1;",
        oldLine: 9,
        newLine: 9,
      }),
    );

    expect(view.isCommentable).toBe(false);
  });

  it("keeps a diff context row commentable", () => {
    const view = getDiffRowView(
      stubParams({
        kind: DiffLineKinds.CTX,
        content: "const a = 1;",
        oldLine: 9,
        newLine: 9,
      }),
    );

    expect(view.isCommentable).toBe(true);
  });
});

describe("isCommentableLine", () => {
  it("accepts an expanded changed row, its line is in the diff", () => {
    expect(
      isCommentableLine({
        kind: DiffLineKinds.ADD,
        origin: DiffRowOrigins.EXPANDED,
        content: "b",
        newLine: 11,
      }),
    ).toBe(true);
    expect(
      isCommentableLine({
        kind: DiffLineKinds.DEL,
        origin: DiffRowOrigins.EXPANDED,
        content: "b",
        oldLine: 14,
      }),
    ).toBe(true);
  });

  it("refuses an expanded context row", () => {
    expect(
      isCommentableLine({
        kind: DiffLineKinds.CTX,
        origin: DiffRowOrigins.EXPANDED,
        content: "b",
        oldLine: 9,
        newLine: 9,
      }),
    ).toBe(false);
  });
});
