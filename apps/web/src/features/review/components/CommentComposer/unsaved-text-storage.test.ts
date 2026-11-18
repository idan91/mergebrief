// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { CommentAnchorKinds, DiffSides } from "types/comments";
import type { CommentAnchor } from "../../utils/comments";
import {
  buildUnsavedCommentKey,
  readUnsavedCommentText,
  writeUnsavedCommentText,
} from "./unsaved-text-storage";

const lineAnchor: CommentAnchor = {
  kind: CommentAnchorKinds.LINE,
  chunkId: "chunk-a",
  file: "src/a.ts",
  side: DiffSides.NEW,
  startLine: 10,
  endLine: 12,
  rowIds: ["row-1"],
  selectedText: "a();",
};
const fileAnchor: CommentAnchor = {
  kind: CommentAnchorKinds.FILE,
  file: "src/a.ts",
};

afterEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("buildUnsavedCommentKey", () => {
  it("keys a line anchor by brief, sides, lines and file", () => {
    expect(buildUnsavedCommentKey("brief-1", lineAnchor, "chunk-b")).toBe(
      "mergebrief.unsavedComment.brief-1.line:new10-new12:src/a.ts",
    );
  });

  it("keys a file anchor by the header that hosts it", () => {
    expect(buildUnsavedCommentKey("brief-1", fileAnchor, "chunk-b")).toBe(
      "mergebrief.unsavedComment.brief-1.file:chunk-b:src/a.ts",
    );
    expect(
      buildUnsavedCommentKey("brief-1", fileAnchor, undefined),
    ).toBeUndefined();
  });

  it("gives the same lines in another brief their own key", () => {
    expect(buildUnsavedCommentKey("brief-2", lineAnchor, "chunk-a")).not.toBe(
      buildUnsavedCommentKey("brief-1", lineAnchor, "chunk-a"),
    );
  });
});

describe("unsaved comment text", () => {
  const key = "mergebrief.unsavedComment.brief-1.line:new10-new12:src/a.ts";

  it("reads back what was written and forgets an empty body", () => {
    writeUnsavedCommentText(key, "half a thought");
    expect(readUnsavedCommentText(key)).toBe("half a thought");
    writeUnsavedCommentText(key, "");
    expect(sessionStorage.getItem(key)).toBeNull();
  });

  it("reads empty and writes nothing when storage is denied", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });

    expect(readUnsavedCommentText(key)).toBe("");
    expect(() => writeUnsavedCommentText(key, "text")).not.toThrow();
  });
});
