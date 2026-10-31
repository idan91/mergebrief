import { describe, expect, it } from "vitest";
import {
  countChunkLayout,
  parseUnifiedDiffPatch,
} from "../../../src/diff/chunk-layout";
import { makeAdd, makeCtx, makeDel, makeHunk } from "./helpers";

const TWO_HUNKS = [
  "@@ -1,6 +1,7 @@",
  " a",
  "-b",
  "+B",
  "+B2",
  " c",
  " d",
  " e",
  "@@ -40,3 +41,4 @@",
  " x",
  "+y",
  " z",
].join("\n");

const EMPTY_HISTOGRAM = [0, 0, 0, 0, 0, 0, 0, 0, 0];

const NEW_FILE = ["@@ -0,0 +1,3 @@", "+a", "+b", "+c"].join("\n");
const DELETED_FILE = ["@@ -1,2 +0,0 @@", "-a", "-b"].join("\n");

describe("countChunkLayout", () => {
  it("counts no expand control on a file the diff creates", () => {
    const counts = countChunkLayout(parseUnifiedDiffPatch(NEW_FILE), {
      addedRanges: [{ start: 2, end: 2 }],
      removedRanges: [],
    });

    expect(counts.rows).toBe(4);
    expect(counts.expandRows).toBe(0);
  });

  it("counts no expand control on a file the diff deletes", () => {
    const counts = countChunkLayout(parseUnifiedDiffPatch(DELETED_FILE), {
      addedRanges: [],
      removedRanges: [{ start: 1, end: 2 }],
    });

    expect(counts.expandRows).toBe(0);
  });

  it("counts the slice, its headers, the trailing control and split rows", () => {
    const counts = countChunkLayout(parseUnifiedDiffPatch(TWO_HUNKS), {
      addedRanges: [
        { start: 2, end: 3 },
        { start: 42, end: 42 },
      ],
      removedRanges: [{ start: 2, end: 2 }],
    });

    expect(counts).toEqual({
      rows: 11,
      hunkRows: 2,
      expandRows: 1,
      splitRows: 10,
      lineWidths: {
        counts: [9, 0, 0, 0, 0, 0, 0, 0, 0],
        overflowColumns: 0,
      },
    });
  });

  it("draws its own row for a gap the slice opened inside one hunk", () => {
    const fileRows = [
      makeHunk(1, 1),
      makeCtx(1, 1),
      makeDel(2),
      makeAdd(2),
      makeCtx(3, 3),
      makeCtx(4, 4),
      makeCtx(5, 5),
      makeCtx(6, 6),
      makeCtx(7, 7),
      makeDel(8),
      makeAdd(8),
      makeCtx(9, 9),
      makeCtx(10, 10),
    ];
    const claimed = [
      { start: 2, end: 2 },
      { start: 8, end: 8 },
    ];

    const counts = countChunkLayout(fileRows, {
      addedRanges: claimed,
      removedRanges: claimed,
    });

    expect(counts.rows).toBe(12);
    expect(counts.hunkRows).toBe(1);
    expect(counts.expandRows).toBe(2);
  });

  it("counts nothing when the chunk's ranges match no row", () => {
    const counts = countChunkLayout(parseUnifiedDiffPatch(TWO_HUNKS), {
      addedRanges: [{ start: 999, end: 999 }],
      removedRanges: [],
    });

    expect(counts).toEqual({
      rows: 0,
      hunkRows: 0,
      expandRows: 0,
      splitRows: 0,
      lineWidths: { counts: EMPTY_HISTOGRAM, overflowColumns: 0 },
    });
  });

  it("buckets code rows by display width, tabs to the next stop", () => {
    const wide = "w".repeat(500);
    const patch = [
      "@@ -1,1 +1,4 @@",
      ` ${"c".repeat(39)}`,
      `+${"a".repeat(40)}`,
      "+\tx",
      `+${wide}`,
    ].join("\n");

    const counts = countChunkLayout(parseUnifiedDiffPatch(patch), {
      addedRanges: [{ start: 2, end: 4 }],
      removedRanges: [],
    });

    expect(counts.lineWidths).toEqual({
      counts: [2, 1, 0, 0, 0, 0, 0, 0, 1],
      overflowColumns: 500,
    });
  });
});
