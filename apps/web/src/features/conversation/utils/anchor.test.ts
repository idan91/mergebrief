// GitHub→chunk anchor mapping — the inverse of submit.ts's old→LEFT /
// new→RIGHT outbound map, over the same DiffLine rows createCommentAnchor
// reads.
import { describe, expect, it } from "vitest";
import type { BriefChunk } from "../../brief/types";
import type { ConversationThread } from "../types";
import { placeThread } from "./anchor";

function chunk(overrides: Partial<BriefChunk> & { id: string }): BriefChunk {
  return {
    changeGroupId: "g1",
    file: "src/a.ts",
    concern: "logic",
    role: "core",
    loc: { added: 3, deleted: 1 },
    addedRanges: [],
    removedRanges: [],
    riskSurface: [],
    diff: [
      { kind: "hunk", content: "@@ -10,4 +10,5 @@" },
      { kind: "ctx", content: "before", oldLine: 10, newLine: 10 },
      { kind: "del", content: "removed line", oldLine: 11 },
      { kind: "add", content: "added line", newLine: 11 },
      { kind: "add", content: "second added", newLine: 12 },
      { kind: "ctx", content: "after", oldLine: 12, newLine: 13 },
    ],
    ...overrides,
  } as BriefChunk;
}

type ThreadOverrides = {
  [K in keyof ConversationThread]?: ConversationThread[K] | undefined;
};

function thread(overrides: ThreadOverrides): ConversationThread {
  // Explicit-undefined overrides mean "omit this key" (exactOptionalPropertyTypes).
  const merged: Record<string, unknown> = {
    rootCommentId: 1001,
    path: "src/a.ts",
    line: 11,
    side: "RIGHT",
    subjectType: "LINE",
    isResolved: false,
    isOutdated: false,
    comments: [
      {
        commentId: 1001,
        author: { login: "alice", isBot: false },
        body: "note",
        createdAt: "2026-07-01T10:00:00Z",
        url: "https://example.test/c/1001",
      },
    ],
    hasMoreComments: false,
    ...overrides,
  };
  for (const key of Object.keys(merged)) {
    if (merged[key] === undefined) delete merged[key];
  }
  return merged as unknown as ConversationThread;
}

describe("placeThread", () => {
  const chunks = [chunk({ id: "c1" })];

  it("places a RIGHT-side thread on the row whose newLine matches", () => {
    const placement = placeThread(thread({ line: 11, side: "RIGHT" }), chunks);
    expect(placement).toEqual({ kind: "chunk", chunkId: "c1", rowId: "c1:3" });
  });

  it("places a LEFT-side thread on the row whose oldLine matches (side inversion)", () => {
    const placement = placeThread(thread({ line: 11, side: "LEFT" }), chunks);
    expect(placement).toEqual({ kind: "chunk", chunkId: "c1", rowId: "c1:2" });
  });

  it("places a context-line thread on either side's numbering", () => {
    const placement = placeThread(thread({ line: 10, side: "RIGHT" }), chunks);
    expect(placement).toEqual({ kind: "chunk", chunkId: "c1", rowId: "c1:1" });
  });

  it("places a multi-line thread by its END line", () => {
    const placement = placeThread(
      thread({ startLine: 11, line: 12, side: "RIGHT", startSide: "RIGHT" }),
      chunks,
    );
    expect(placement).toEqual({ kind: "chunk", chunkId: "c1", rowId: "c1:4" });
  });

  it("short-circuits an outdated thread — no row match attempted", () => {
    // Line 11 WOULD match a row; outdated coordinates describe the
    // anchor-time diff, so they must not be trusted.
    const placement = placeThread(
      thread({ isOutdated: true, line: 11, side: "RIGHT" }),
      chunks,
    );
    expect(placement).toEqual({ kind: "unanchored", reason: "outdated" });
  });

  it("reports a file absent from every chunk (rename) as file-not-in-brief", () => {
    const placement = placeThread(thread({ path: "src/renamed.ts" }), chunks);
    expect(placement).toEqual({
      kind: "unanchored",
      reason: "file-not-in-brief",
    });
  });

  it("reports a line outside every chunk's rows as line-outside-chunks", () => {
    const placement = placeThread(thread({ line: 999 }), chunks);
    expect(placement).toEqual({
      kind: "unanchored",
      reason: "line-outside-chunks",
    });
  });

  it("treats a file-level thread (no line) as line-outside-chunks when the file is present", () => {
    const placement = placeThread(
      thread({ line: undefined, side: undefined, subjectType: "FILE" }),
      chunks,
    );
    expect(placement).toEqual({
      kind: "unanchored",
      reason: "line-outside-chunks",
    });
  });

  it("defaults a missing side to RIGHT (new-side numbering)", () => {
    const placement = placeThread(
      thread({ line: 12, side: undefined }),
      chunks,
    );
    expect(placement).toEqual({ kind: "chunk", chunkId: "c1", rowId: "c1:4" });
  });

  it("scans chunks in reading order and takes the first match", () => {
    const twoChunks = [
      chunk({
        id: "c1",
        diff: [{ kind: "ctx", content: "x", oldLine: 1, newLine: 1 }],
      }),
      chunk({ id: "c2" }),
      chunk({ id: "c3" }),
    ];
    const placement = placeThread(
      thread({ line: 11, side: "RIGHT" }),
      twoChunks,
    );
    expect(placement).toEqual({ kind: "chunk", chunkId: "c2", rowId: "c2:3" });
  });

  it("skips hunk and note rows even when line numbers collide", () => {
    const noteChunk = chunk({
      id: "n1",
      diff: [
        { kind: "note", content: "a note", newLine: 11 },
        { kind: "add", content: "real", newLine: 11 },
      ],
    });
    const placement = placeThread(thread({ line: 11, side: "RIGHT" }), [
      noteChunk,
    ]);
    expect(placement).toEqual({ kind: "chunk", chunkId: "n1", rowId: "n1:1" });
  });

  it("reports a chunk without diff rows as line-outside-chunks (file present)", () => {
    const bare = chunk({ id: "c1" });
    const { diff: _diff, ...rest } = bare;
    const placement = placeThread(thread({ line: 11 }), [rest as BriefChunk]);
    expect(placement).toEqual({
      kind: "unanchored",
      reason: "line-outside-chunks",
    });
  });
});
