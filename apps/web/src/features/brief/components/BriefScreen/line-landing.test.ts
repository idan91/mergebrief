import { describe, expect, it } from "vitest";

import { Concerns, Roles } from "brief-core/types";
import { type BriefChunk } from "../../types";
import { collectSelectionRowIds, planLineLanding } from "./line-landing";

function stubChunk(overrides: Partial<BriefChunk>): BriefChunk {
  return {
    id: "c1",
    changeGroupId: "g1",
    file: "src/a.ts",
    concern: Concerns.IMPLEMENTATION,
    role: Roles.CORE,
    loc: { added: 1, deleted: 1 },
    addedRanges: [{ start: 31, end: 31 }],
    removedRanges: [{ start: 34, end: 34 }],
    riskSurface: [],
    diff: [
      { kind: "hunk", content: "@@ -33,3 +30,3 @@" },
      { kind: "ctx", content: "a", oldLine: 33, newLine: 30 },
      { kind: "del", content: "b", oldLine: 34 },
      { kind: "add", content: "c", newLine: 31 },
      { kind: "ctx", content: "d", oldLine: 35, newLine: 32 },
    ],
    ...overrides,
  };
}

const CHUNKS = [
  stubChunk({}),
  stubChunk({
    id: "c2",
    addedRanges: [{ start: 90, end: 90 }],
    removedRanges: [],
    diff: [
      { kind: "hunk", content: "@@ -92,2 +89,3 @@" },
      { kind: "ctx", content: "x", oldLine: 92, newLine: 89 },
      { kind: "add", content: "y", newLine: 90 },
      { kind: "ctx", content: "z", oldLine: 93, newLine: 91 },
    ],
  }),
  stubChunk({ id: "other", file: "src/b.ts" }),
];

describe("planLineLanding", () => {
  it("lands a shown line on its chunk with no read", () => {
    const plan = planLineLanding(CHUNKS, {
      chunkId: "c1",
      side: "new",
      startLine: 31,
      endLine: 31,
    });
    expect(plan).toEqual({
      kind: "land",
      chunk: CHUNKS[0],
      row: { side: "new", line: 31 },
    });
  });

  it("lands an old-side line by its old number", () => {
    const plan = planLineLanding(CHUNKS, {
      chunkId: "c1",
      side: "old",
      startLine: 34,
      endLine: 34,
    });
    expect(plan).toMatchObject({
      kind: "land",
      row: { side: "old", line: 34 },
    });
  });

  it("uses the crossing range's start side for the row", () => {
    const plan = planLineLanding(CHUNKS, {
      chunkId: "c1",
      side: "new",
      startSide: "old",
      startLine: 34,
      endLine: 31,
    });
    expect(plan).toMatchObject({
      kind: "land",
      row: { side: "old", line: 34 },
    });
  });

  it("reads from the nearer hunk edge to a folded line", () => {
    // 40 sits below c1's rows (30-32): c1's down edge is the nearer edge of
    // the gap that holds it.
    const plan = planLineLanding(CHUNKS, {
      chunkId: "c1",
      side: "new",
      startLine: 40,
      endLine: 40,
    });
    expect(plan).toMatchObject({
      kind: "land",
      chunk: { id: "c1" },
      read: { edgeKey: "c1:5:down", range: { start: 33, end: 40 } },
    });
  });

  it("reads up from a line above the first hunk", () => {
    const plan = planLineLanding(CHUNKS, {
      chunkId: "c1",
      side: "new",
      startLine: 20,
      endLine: 20,
    });
    expect(plan).toMatchObject({
      kind: "land",
      chunk: { id: "c1" },
      read: { edgeKey: "c1:1:up", range: { start: 20, end: 29 } },
    });
  });

  it("maps a folded old line through the edge's offset", () => {
    // Old 40 is new 37 below c1 (offset 3 after the hunk).
    const plan = planLineLanding(CHUNKS, {
      chunkId: "c1",
      side: "old",
      startLine: 40,
      endLine: 40,
    });
    expect(plan).toMatchObject({
      kind: "land",
      read: { range: { start: 33, end: 37 } },
    });
  });

  it("reads the start's own gap when the ends fold into different gaps", () => {
    const plan = planLineLanding(CHUNKS, {
      chunkId: "c1",
      side: "new",
      startLine: 28,
      endLine: 34,
    });
    expect(plan).toMatchObject({
      kind: "land",
      chunk: { id: "c1" },
      row: { side: "new", line: 28 },
      read: { edgeKey: "c1:1:up", range: { start: 28, end: 29 } },
    });
  });

  it("marks whether the read covers the range's first line", () => {
    expect(
      planLineLanding(CHUNKS, {
        chunkId: "c1",
        side: "new",
        startLine: 31,
        endLine: 40,
      }),
    ).toMatchObject({ read: { coversStart: false } });
    expect(
      planLineLanding(CHUNKS, {
        chunkId: "c1",
        side: "new",
        startLine: 40,
        endLine: 40,
      }),
    ).toMatchObject({ read: { coversStart: true } });
  });

  it("lands on the card once the rows have settled without arriving", () => {
    const bare = stubChunk({});
    delete bare.diff;
    expect(
      planLineLanding(
        [bare],
        { chunkId: "c1", side: "new", startLine: 31, endLine: 31 },
        true,
      ),
    ).toEqual({ kind: "card", chunk: bare });
  });

  it("is pending while the chunk's rows are not attached", () => {
    const bare = stubChunk({});
    delete bare.diff;
    expect(
      planLineLanding(
        [bare],
        { chunkId: "c1", side: "new", startLine: 31, endLine: 31 },
        false,
      ),
    ).toEqual({ kind: "pending" });
  });

  it("misses a chunk the brief does not carry", () => {
    expect(
      planLineLanding(CHUNKS, {
        chunkId: "nope",
        side: "new",
        startLine: 1,
        endLine: 1,
      }),
    ).toEqual({ kind: "miss" });
  });

  it("lands an old line through the rows that show that side", () => {
    // c2 adds only, yet its context rows show old 92 and 93.
    expect(
      planLineLanding([CHUNKS[1]!], {
        chunkId: "c2",
        side: "old",
        startLine: 92,
        endLine: 92,
      }),
    ).toMatchObject({
      kind: "land",
      chunk: { id: "c2" },
      row: { side: "old", line: 92 },
    });
    expect(
      planLineLanding([CHUNKS[1]!], {
        chunkId: "c2",
        side: "old",
        startLine: 5,
        endLine: 5,
      }),
    ).toMatchObject({
      kind: "land",
      chunk: { id: "c2" },
      read: { edgeKey: "c2:1:up", range: { start: 2, end: 88 } },
    });
  });

  it("reads to the far end of a range below the last hunk", () => {
    expect(
      planLineLanding(CHUNKS, {
        chunkId: "c1",
        side: "new",
        startLine: 40,
        endLine: 50,
      }),
    ).toMatchObject({
      read: { edgeKey: "c1:5:down", range: { start: 33, end: 50 } },
    });
  });

  it("reads the folded end of a range whose start is shown", () => {
    expect(
      planLineLanding(CHUNKS, {
        chunkId: "c1",
        side: "new",
        startLine: 31,
        endLine: 40,
      }),
    ).toMatchObject({
      row: { side: "new", line: 31 },
      read: { edgeKey: "c1:5:down", range: { start: 33, end: 40 } },
    });
  });

  it("reads from the nearer edge of an inner gap", () => {
    const twoHunks = stubChunk({
      id: "h",
      addedRanges: [
        { start: 11, end: 11 },
        { start: 31, end: 31 },
      ],
      removedRanges: [],
      diff: [
        { kind: "hunk", content: "@@ -10,2 +10,3 @@" },
        { kind: "ctx", content: "a", oldLine: 10, newLine: 10 },
        { kind: "add", content: "b", newLine: 11 },
        { kind: "ctx", content: "c", oldLine: 11, newLine: 12 },
        { kind: "hunk", content: "@@ -29,2 +30,3 @@" },
        { kind: "ctx", content: "d", oldLine: 29, newLine: 30 },
        { kind: "add", content: "e", newLine: 31 },
        { kind: "ctx", content: "f", oldLine: 30, newLine: 32 },
      ],
    });
    const plan = planLineLanding([twoHunks], {
      chunkId: "h",
      side: "new",
      startLine: 28,
      endLine: 28,
    });
    expect(plan).toMatchObject({
      kind: "land",
      read: { range: { start: 28, end: 29 } },
    });
    expect(plan).toMatchObject({
      read: { edgeKey: expect.stringMatching(/:up$/) },
    });
  });
});

describe("collectSelectionRowIds", () => {
  it("names the chunk's rows in a same-side range", () => {
    expect(
      collectSelectionRowIds(CHUNKS[0]!, {
        chunkId: "c1",
        side: "new",
        startLine: 30,
        endLine: 31,
      }),
    ).toEqual(["c1:1", "c1:3"]);
  });

  it("names nothing for a crossing range or a folded one", () => {
    expect(
      collectSelectionRowIds(CHUNKS[0]!, {
        chunkId: "c1",
        side: "new",
        startSide: "old",
        startLine: 34,
        endLine: 31,
      }),
    ).toEqual([]);
    expect(
      collectSelectionRowIds(CHUNKS[0]!, {
        chunkId: "c1",
        side: "new",
        startLine: 40,
        endLine: 41,
      }),
    ).toEqual([]);
  });
});
