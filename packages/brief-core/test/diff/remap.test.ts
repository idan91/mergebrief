import { describe, expect, it } from "vitest";
import {
  parseHunkSpans,
  remapRanges,
  remapThroughPatch,
  RemapOutcomes,
} from "../../src/diff/remap";

/**
 * The line-offset remapper: hunk-header offsets from an
 * incremental diff → new-side ranges for carried (frozen) chunk ranges.
 * Ambiguity — a hunk overlapping a carried range — returns a demotion
 * verdict, never a guessed range.
 */

describe("parseHunkSpans", () => {
  it("parses full and short @@ headers", () => {
    const patch = [
      "diff --git a/f b/f",
      "--- a/f",
      "+++ b/f",
      "@@ -10,3 +12,4 @@ context",
      " x",
      "@@ -30 +33 @@",
      " y",
    ].join("\n");
    expect(parseHunkSpans(patch)).toEqual([
      { oldStart: 10, oldLines: 3, newStart: 12, newLines: 4 },
      { oldStart: 30, oldLines: 1, newStart: 33, newLines: 1 },
    ]);
  });

  it("parses zero-length sides (pure insertion / pure deletion)", () => {
    const patch = ["@@ -5,0 +6,2 @@", "@@ -9,2 +12,0 @@"].join("\n");
    expect(parseHunkSpans(patch)).toEqual([
      { oldStart: 5, oldLines: 0, newStart: 6, newLines: 2 },
      { oldStart: 9, oldLines: 2, newStart: 12, newLines: 0 },
    ]);
  });
});

describe("remapRanges", () => {
  it("is identity when there are no hunks", () => {
    const result = remapRanges([{ start: 3, end: 9 }], []);
    expect(result).toEqual({
      outcome: RemapOutcomes.REMAPPED,
      ranges: [{ start: 3, end: 9 }],
    });
  });

  it("leaves a range strictly before every hunk untouched", () => {
    const result = remapRanges(
      [{ start: 1, end: 4 }],
      [{ oldStart: 10, oldLines: 3, newStart: 10, newLines: 6 }],
    );
    expect(result).toEqual({
      outcome: RemapOutcomes.REMAPPED,
      ranges: [{ start: 1, end: 4 }],
    });
  });

  it("shifts a range after a hunk by the hunk's size delta", () => {
    // Hunk replaces 3 old lines with 6 → +3 for everything after it.
    const result = remapRanges(
      [{ start: 20, end: 25 }],
      [{ oldStart: 10, oldLines: 3, newStart: 10, newLines: 6 }],
    );
    expect(result).toEqual({
      outcome: RemapOutcomes.REMAPPED,
      ranges: [{ start: 23, end: 28 }],
    });
  });

  it("accumulates deltas across multiple earlier hunks", () => {
    const result = remapRanges(
      [{ start: 50, end: 51 }],
      [
        { oldStart: 5, oldLines: 2, newStart: 5, newLines: 1 }, // -1
        { oldStart: 20, oldLines: 1, newStart: 19, newLines: 4 }, // +3
      ],
    );
    expect(result).toEqual({
      outcome: RemapOutcomes.REMAPPED,
      ranges: [{ start: 52, end: 53 }],
    });
  });

  it("demotes when a hunk overlaps a carried range", () => {
    const result = remapRanges(
      [{ start: 8, end: 12 }],
      [{ oldStart: 10, oldLines: 3, newStart: 10, newLines: 3 }],
    );
    expect(result.outcome).toBe(RemapOutcomes.DEMOTED);
  });

  it("demotes on a pure insertion strictly inside a range (would split it)", () => {
    // "-7,0" = insertion after old line 7; range 5..10 straddles it.
    const result = remapRanges(
      [{ start: 5, end: 10 }],
      [{ oldStart: 7, oldLines: 0, newStart: 8, newLines: 2 }],
    );
    expect(result.outcome).toBe(RemapOutcomes.DEMOTED);
  });

  it("shifts past a pure insertion at or before the range start", () => {
    // Insertion after old line 4; range starts at 5 → whole range shifts +2.
    const result = remapRanges(
      [{ start: 5, end: 10 }],
      [{ oldStart: 4, oldLines: 0, newStart: 5, newLines: 2 }],
    );
    expect(result).toEqual({
      outcome: RemapOutcomes.REMAPPED,
      ranges: [{ start: 7, end: 12 }],
    });
  });

  it("leaves a range untouched when a pure insertion sits at or after its end", () => {
    // Insertion after old line 10; range 5..10 stays put.
    const result = remapRanges(
      [{ start: 5, end: 10 }],
      [{ oldStart: 10, oldLines: 0, newStart: 11, newLines: 3 }],
    );
    expect(result).toEqual({
      outcome: RemapOutcomes.REMAPPED,
      ranges: [{ start: 5, end: 10 }],
    });
  });

  it("demotes on a pure insertion exactly at the start of a multi-line range", () => {
    // Insertion after old line 5 splits range 5..10 (line 5 stays, 6..10
    // shift) — must demote, never carry unshifted.
    const result = remapRanges(
      [{ start: 5, end: 10 }],
      [{ oldStart: 5, oldLines: 0, newStart: 6, newLines: 2 }],
    );
    expect(result.outcome).toBe(RemapOutcomes.DEMOTED);
  });

  it("a single-line range with an insertion after its own line stays put", () => {
    const result = remapRanges(
      [{ start: 5, end: 5 }],
      [{ oldStart: 5, oldLines: 0, newStart: 6, newLines: 2 }],
    );
    expect(result).toEqual({
      outcome: RemapOutcomes.REMAPPED,
      ranges: [{ start: 5, end: 5 }],
    });
  });

  it("a hunk ending exactly at start-1 still shifts the range", () => {
    // Hunk covers old lines 3..4 (2 → 5 lines, +3); range starts at 5.
    const result = remapRanges(
      [{ start: 5, end: 8 }],
      [{ oldStart: 3, oldLines: 2, newStart: 3, newLines: 5 }],
    );
    expect(result).toEqual({
      outcome: RemapOutcomes.REMAPPED,
      ranges: [{ start: 8, end: 11 }],
    });
  });

  it("demotes the whole call when ANY range is ambiguous", () => {
    const result = remapRanges(
      [
        { start: 1, end: 2 },
        { start: 10, end: 11 },
      ],
      [{ oldStart: 11, oldLines: 1, newStart: 11, newLines: 1 }],
    );
    expect(result.outcome).toBe(RemapOutcomes.DEMOTED);
  });
});

describe("remapThroughPatch", () => {
  it("remaps ranges through a file patch's hunk headers", () => {
    const patch = [
      "diff --git a/f b/f",
      "--- a/f",
      "+++ b/f",
      "@@ -1,2 +1,5 @@",
      " ctx",
      "+a",
      "+b",
      "+c",
      " ctx",
    ].join("\n");
    const result = remapThroughPatch([{ start: 40, end: 44 }], patch);
    expect(result).toEqual({
      outcome: RemapOutcomes.REMAPPED,
      ranges: [{ start: 43, end: 47 }],
    });
  });
});
