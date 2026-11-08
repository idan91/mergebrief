import { describe, expect, it } from "vitest";

import { CommentAnchorKinds, DiffSides } from "types/comments";
import type { CommentAnchor } from "../../utils/comments";
import { ComposerStateKinds, type ComposerState } from "./types";
import {
  armReanchorState,
  cancelComposerState,
  disarmReanchorState,
  dismissComposer,
  getComposerAnchor,
  getComposerHost,
  getHostedLineAnchor,
  getReanchorDraftId,
  isComposerSaving,
  isHostingFileComposer,
  isHostSaving,
  isSameCommentPlace,
  isSameComposerPlace,
  openComposerState,
  settleComposerSave,
  startComposerSave,
} from "./utils";

const lineAnchor: CommentAnchor = {
  kind: CommentAnchorKinds.LINE,
  chunkId: "chunk-a",
  file: "src/a.ts",
  side: DiffSides.NEW,
  startLine: 10,
  endLine: 10,
  rowIds: ["row-1"],
  selectedText: "validate(a);",
};
const fileAnchor: CommentAnchor = {
  kind: CommentAnchorKinds.FILE,
  file: "src/a.ts",
};

const closed: ComposerState = { kind: ComposerStateKinds.CLOSED };
const open: ComposerState = {
  kind: ComposerStateKinds.OPEN,
  anchor: lineAnchor,
  host: "chunk-a",
};
const saving: ComposerState = {
  kind: ComposerStateKinds.SAVING,
  anchor: lineAnchor,
  host: "chunk-a",
  token: 1,
};
const reanchoring: ComposerState = {
  kind: ComposerStateKinds.REANCHORING,
  draftId: "draft-1",
};

describe("openComposerState", () => {
  it("opens at the anchor in the host from any idle state", () => {
    const expected = {
      kind: ComposerStateKinds.OPEN,
      anchor: fileAnchor,
      host: "chunk-b",
    };
    expect(openComposerState(closed, fileAnchor, "chunk-b")).toEqual(expected);
    expect(openComposerState(open, fileAnchor, "chunk-b")).toEqual(expected);
    expect(openComposerState(reanchoring, fileAnchor, "chunk-b")).toEqual(
      expected,
    );
  });

  it("keeps a saving composer where it is", () => {
    expect(openComposerState(saving, fileAnchor, "chunk-b")).toBe(saving);
  });
});

describe("startComposerSave", () => {
  it("moves an open composer to saving under the token", () => {
    expect(startComposerSave(open, 7)).toEqual({
      ...open,
      kind: ComposerStateKinds.SAVING,
      token: 7,
    });
  });

  it("starts nothing when no composer is open", () => {
    expect(startComposerSave(closed, 7)).toBe(closed);
    expect(startComposerSave(saving, 7)).toBe(saving);
    expect(startComposerSave(reanchoring, 7)).toBe(reanchoring);
  });
});

describe("settleComposerSave", () => {
  it("closes on a landed save under the current token", () => {
    expect(settleComposerSave(saving, 1, true)).toEqual(closed);
  });

  it("reopens holding its anchor on a failed save", () => {
    expect(settleComposerSave(saving, 1, false)).toEqual(open);
  });

  it("ignores a settle whose token is no longer current", () => {
    const newer = { ...saving, token: 2 };
    expect(settleComposerSave(newer, 1, true)).toBe(newer);
    expect(settleComposerSave(open, 1, true)).toBe(open);
    expect(settleComposerSave(closed, 1, false)).toBe(closed);
  });
});

describe("dismissComposer", () => {
  it("closes an open or saving composer", () => {
    expect(dismissComposer(open)).toEqual(closed);
    expect(dismissComposer(saving)).toEqual(closed);
  });

  it("leaves an armed re-anchor alone", () => {
    expect(dismissComposer(reanchoring)).toBe(reanchoring);
  });
});

describe("cancelComposerState", () => {
  it("closes an open composer", () => {
    expect(cancelComposerState(open)).toEqual(closed);
  });

  it("refuses while the save is in flight", () => {
    expect(cancelComposerState(saving)).toBe(saving);
  });

  it("leaves an armed re-anchor to its own cancel", () => {
    expect(cancelComposerState(reanchoring)).toBe(reanchoring);
  });
});

describe("armReanchorState", () => {
  it("arms the draft and closes an open composer", () => {
    const expected = { kind: ComposerStateKinds.REANCHORING, draftId: "d2" };
    expect(armReanchorState(open, "d2")).toEqual(expected);
    expect(armReanchorState(closed, "d2")).toEqual(expected);
    expect(armReanchorState(reanchoring, "d2")).toEqual(expected);
  });

  it("keeps a saving composer where it is", () => {
    expect(armReanchorState(saving, "d2")).toBe(saving);
  });
});

describe("disarmReanchorState", () => {
  it("closes an armed re-anchor", () => {
    expect(disarmReanchorState(reanchoring)).toEqual(closed);
  });

  it("leaves every other state alone", () => {
    expect(disarmReanchorState(open)).toBe(open);
    expect(disarmReanchorState(saving)).toBe(saving);
    expect(disarmReanchorState(closed)).toBe(closed);
  });
});

describe("composer readers", () => {
  it("read the anchor and host of an open or saving composer", () => {
    expect(getComposerAnchor(open)).toBe(lineAnchor);
    expect(getComposerHost(saving)).toBe("chunk-a");
    expect(getComposerAnchor(closed)).toBeUndefined();
    expect(getComposerHost(reanchoring)).toBeUndefined();
  });

  it("read saving and the armed draft only in their own states", () => {
    expect(isComposerSaving(saving)).toBe(true);
    expect(isComposerSaving(open)).toBe(false);
    expect(getReanchorDraftId(reanchoring)).toBe("draft-1");
    expect(getReanchorDraftId(open)).toBeUndefined();
  });
});

describe("host readers", () => {
  const fileOpen: ComposerState = {
    kind: ComposerStateKinds.OPEN,
    anchor: fileAnchor,
    host: "chunk-b",
  };

  it("give a line composer only to the table that hosts it", () => {
    expect(getHostedLineAnchor(open, "chunk-a")).toBe(lineAnchor);
    expect(getHostedLineAnchor(open, "chunk-b")).toBeUndefined();
    expect(getHostedLineAnchor(fileOpen, "chunk-b")).toBeUndefined();
  });

  it("give a file composer only to the header that opened it", () => {
    expect(isHostingFileComposer(fileOpen, "chunk-b")).toBe(true);
    expect(isHostingFileComposer(fileOpen, "chunk-a")).toBe(false);
    expect(isHostingFileComposer(open, "chunk-a")).toBe(false);
  });

  it("report saving only to the host of the save", () => {
    expect(isHostSaving(saving, "chunk-a")).toBe(true);
    expect(isHostSaving(saving, "chunk-b")).toBe(false);
    expect(isHostSaving(open, "chunk-a")).toBe(false);
  });
});

describe("isSameCommentPlace", () => {
  it("matches lines by file, sides and range, not by row ids", () => {
    expect(isSameCommentPlace(lineAnchor, { ...lineAnchor, rowIds: [] })).toBe(
      true,
    );
    expect(isSameCommentPlace(lineAnchor, { ...lineAnchor, endLine: 11 })).toBe(
      false,
    );
    expect(
      isSameCommentPlace(lineAnchor, {
        ...lineAnchor,
        startSide: DiffSides.OLD,
      }),
    ).toBe(false);
  });

  it("matches a file comment by its file only", () => {
    expect(isSameCommentPlace(fileAnchor, { ...fileAnchor })).toBe(true);
    expect(isSameCommentPlace(fileAnchor, lineAnchor)).toBe(false);
    expect(
      isSameCommentPlace(fileAnchor, { ...fileAnchor, file: "src/b.ts" }),
    ).toBe(false);
  });
});

describe("isSameComposerPlace", () => {
  it("ignores the host for lines and compares it for a file", () => {
    const lineA = { anchor: lineAnchor, host: "chunk-a" };
    const fileA = { anchor: fileAnchor, host: "chunk-a" };
    expect(isSameComposerPlace(lineA, { ...lineA, host: "chunk-b" })).toBe(
      true,
    );
    expect(isSameComposerPlace(fileA, { ...fileA })).toBe(true);
    expect(isSameComposerPlace(fileA, { ...fileA, host: "chunk-b" })).toBe(
      false,
    );
  });
});
