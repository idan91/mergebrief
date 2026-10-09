import { describe, expect, it } from "vitest";

import { Concerns, Roles } from "brief-core/types";
import type { DiffLine } from "@web/utils/diffTokens/types";
import { GuestRowReasons, type BriefChunk } from "../types";
import { GroupViewKinds } from "./remainder";
import type { FileLineOwners } from "./lineOwner";
import { resolveChunkForLine } from "@web/features/review/utils";
import {
  type GuestRowsInput,
  resolveGuestRow,
  resolveGuestRows,
} from "./guest-rows";

function stubChunk(overrides: Partial<BriefChunk>): BriefChunk {
  return {
    id: "c1",
    changeGroupId: "g1",
    file: "src/a.ts",
    concern: Concerns.IMPLEMENTATION,
    role: Roles.CORE,
    loc: { added: 0, deleted: 0 },
    addedRanges: [],
    removedRanges: [],
    riskSurface: [],
    ...overrides,
  };
}

const OWN = stubChunk({
  id: "c1",
  addedRanges: [{ start: 10, end: 12 }],
  removedRanges: [{ start: 9, end: 9 }],
});
const SIBLING = stubChunk({
  id: "c2",
  changeGroupId: "g2",
  addedRanges: [{ start: 40, end: 41 }],
});
const REMAINDER = stubChunk({
  id: "u-1",
  changeGroupId: GroupViewKinds.UNATTRIBUTED_REMAINDER,
  addedRanges: [{ start: 60, end: 60 }],
});

const OWNERS: FileLineOwners = {
  chunks: [OWN, SIBLING, REMAINDER],
  owners: new Map(),
};

/** The PR base to head rows of `src/a.ts`: two hunks, context around each change. */
const FILE_ROWS: DiffLine[] = [
  { kind: "hunk", content: "@@ -8,4 +8,5 @@" },
  { kind: "ctx", content: "a", oldLine: 8, newLine: 8 },
  { kind: "del", content: "gone", oldLine: 9 },
  { kind: "add", content: "b", newLine: 9 },
  { kind: "add", content: "c", newLine: 10 },
  { kind: "add", content: "d", newLine: 11 },
  { kind: "add", content: "e", newLine: 12 },
  { kind: "ctx", content: "f", oldLine: 10, newLine: 13 },
  { kind: "hunk", content: "@@ -36,3 +39,5 @@" },
  { kind: "ctx", content: "g", oldLine: 36, newLine: 39 },
  { kind: "add", content: "h", newLine: 40 },
  { kind: "add", content: "i", newLine: 41 },
  { kind: "ctx", content: "j", oldLine: 37, newLine: 42 },
  { kind: "ctx", content: "k", oldLine: 38, newLine: 43 },
];

function stubInput(overrides: Partial<GuestRowsInput> = {}): GuestRowsInput {
  return {
    file: "src/a.ts",
    fileRows: FILE_ROWS,
    owners: OWNERS,
    ...overrides,
  };
}

describe("resolveGuestRow", () => {
  it("anchors a right-side row of the PR diff to the chunk holding its line", () => {
    const line: DiffLine = { kind: "add", content: "h", newLine: 40 };

    expect(resolveGuestRow(line, stubInput())).toEqual({
      commentable: true,
      chunkId: "c2",
      side: "new",
      line: 40,
    });
  });

  it("refuses a left-side row: its line is in baseline coordinates", () => {
    const line: DiffLine = { kind: "del", content: "x", oldLine: 40 };

    expect(resolveGuestRow(line, stubInput())).toEqual({
      commentable: false,
      reason: GuestRowReasons.REMOVED_BEFORE_HEAD,
    });
  });

  it("refuses a right-side row the PR diff does not carry", () => {
    const line: DiffLine = {
      kind: "ctx",
      content: "far",
      oldLine: 90,
      newLine: 99,
    };

    expect(resolveGuestRow(line, stubInput())).toEqual({
      commentable: false,
      reason: GuestRowReasons.NOT_IN_PR_DIFF,
    });
  });

  it("treats a file the PR diff has no rows for as outside the PR diff", () => {
    const line: DiffLine = { kind: "add", content: "h", newLine: 40 };

    expect(resolveGuestRow(line, stubInput({ fileRows: [] }))).toEqual({
      commentable: false,
      reason: GuestRowReasons.NOT_IN_PR_DIFF,
    });
  });

  it("names the PR diff unavailable while it has no rows to check against", () => {
    const line: DiffLine = { kind: "add", content: "h", newLine: 40 };

    expect(resolveGuestRow(line, stubInput({ fileRows: undefined }))).toEqual({
      commentable: false,
      reason: GuestRowReasons.PR_DIFF_UNAVAILABLE,
    });
  });

  it("falls a context row to the chunk whose envelope or neighbour it is", () => {
    const inside: DiffLine = {
      kind: "ctx",
      content: "j",
      oldLine: 37,
      newLine: 42,
    };
    const before: DiffLine = {
      kind: "ctx",
      content: "a",
      oldLine: 8,
      newLine: 8,
    };

    expect(resolveGuestRow(inside, stubInput())).toMatchObject({
      commentable: true,
      chunkId: "c2",
      line: 42,
    });
    expect(resolveGuestRow(before, stubInput())).toMatchObject({
      commentable: true,
      chunkId: "c1",
      line: 8,
    });
  });

  it("refuses a row of a file no chunk of the brief touches", () => {
    const line: DiffLine = { kind: "add", content: "h", newLine: 40 };
    const input = stubInput({ owners: undefined });

    expect(resolveGuestRow(line, input)).toEqual({
      commentable: false,
      reason: GuestRowReasons.FILE_NOT_IN_BRIEF,
    });
    expect(
      resolveGuestRow(
        line,
        stubInput({ owners: { chunks: [], owners: new Map() } }),
      ),
    ).toEqual({
      commentable: false,
      reason: GuestRowReasons.FILE_NOT_IN_BRIEF,
    });
  });

  it("names the chunk a draft reads back into, not the origin", () => {
    const line: DiffLine = {
      kind: "ctx",
      content: "g",
      oldLine: 36,
      newLine: 39,
    };

    expect(
      resolveGuestRow(line, stubInput(), { chunkId: "c2", index: 1 }),
    ).toMatchObject({
      commentable: true,
      chunkId: resolveChunkForLine(OWNERS.chunks, "src/a.ts", "new", 39)?.id,
    });
  });

  it("takes a row from an owner's own diff as in the PR diff", () => {
    const line: DiffLine = {
      kind: "ctx",
      content: "k",
      oldLine: 38,
      newLine: 43,
    };
    const input = stubInput({ fileRows: [] });

    expect(resolveGuestRow(line, input, { chunkId: "c2", index: 3 })).toEqual({
      commentable: true,
      chunkId: "c2",
      side: "new",
      line: 43,
    });
  });

  it("resolves a row whose origin names no owner of the file like any other", () => {
    const line: DiffLine = { kind: "add", content: "h", newLine: 40 };

    expect(
      resolveGuestRow(line, stubInput(), { chunkId: "elsewhere", index: 0 }),
    ).toMatchObject({ commentable: true, chunkId: "c2" });
  });

  it("names the chunk a draft on the line reads back into", () => {
    const line: DiffLine = { kind: "add", content: "h", newLine: 40 };
    const overlapping = stubChunk({
      id: "c9",
      addedRanges: [{ start: 39, end: 45 }],
    });
    const chunks = [overlapping, SIBLING, REMAINDER];
    const input = stubInput({ owners: { chunks, owners: new Map() } });

    expect(resolveGuestRow(line, input)).toMatchObject({
      chunkId: resolveChunkForLine(chunks, "src/a.ts", "new", 40)?.id,
    });
  });
});

describe("resolveGuestRows", () => {
  it("skips full-width rows and resolves the rest against one line set", () => {
    const rows: DiffLine[] = [
      { kind: "hunk", content: "@@" },
      { kind: "add", content: "h", newLine: 40 },
      { kind: "del", content: "x", oldLine: 40 },
    ];

    expect(
      resolveGuestRows(rows, stubInput(), (row) => row.kind !== "hunk"),
    ).toEqual([
      undefined,
      { commentable: true, chunkId: "c2", side: "new", line: 40 },
      { commentable: false, reason: GuestRowReasons.REMOVED_BEFORE_HEAD },
    ]);
  });
});
