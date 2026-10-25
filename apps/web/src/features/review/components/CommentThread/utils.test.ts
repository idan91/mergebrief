import { describe, expect, it } from "vitest";
import { CommentAnchorKinds, DiffSides } from "types";

import type { LineCommentAnchor } from "../../utils/comments";
import { readSideSign } from "./utils";

const OLD_SIDE_ANCHOR: LineCommentAnchor = {
  kind: CommentAnchorKinds.LINE,
  file: "a.ts",
  chunkId: "chunk-1",
  side: DiffSides.OLD,
  startLine: 4,
  endLine: 6,
  rowIds: [],
  selectedText: "",
};

describe("readSideSign", () => {
  it("reads a range's start side before its end side", () => {
    const crossing = { ...OLD_SIDE_ANCHOR, startSide: DiffSides.NEW };

    expect(readSideSign(crossing)).toBe("+");
  });

  it("falls back to the comment's own side", () => {
    expect(readSideSign(OLD_SIDE_ANCHOR)).toBe("-");
  });
});
