/**
 * Line-offset remapper: carries a frozen chunk's old-side (prevHead) line ranges
 * into new-side (head) coordinates using ONLY the incremental diff's `@@` hunk
 * headers — no content inspection. Any hunk overlapping a carried range returns
 * a demotion verdict instead of a guessed range: the FE joins on exact line
 * numbers, so a wrong range is worse than a re-look.
 */
import type { ValueOf } from "types";
import type { LineRange } from "../types";

export const RemapOutcomes = {
  REMAPPED: "remapped",
  DEMOTED: "demoted",
} as const;
export type RemapOutcome = ValueOf<typeof RemapOutcomes>;

/** One `@@ -old,+new @@` header, both sides as (start, line count). */
export interface HunkSpan {
  readonly oldStart: number;
  readonly oldLines: number;
  readonly newStart: number;
  readonly newLines: number;
}

export type RemapResult =
  | {
      readonly outcome: typeof RemapOutcomes.REMAPPED;
      readonly ranges: readonly LineRange[];
    }
  | { readonly outcome: typeof RemapOutcomes.DEMOTED; readonly reason: string };

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/** Extract every hunk header of one file's patch (count defaults to 1). */
export function parseHunkSpans(patch: string): HunkSpan[] {
  const spans: HunkSpan[] = [];
  for (const line of patch.split("\n")) {
    const match = HUNK_HEADER.exec(line);
    if (match?.[1] === undefined || match[3] === undefined) continue;
    spans.push({
      oldStart: Number(match[1]),
      oldLines: match[2] === undefined ? 1 : Number(match[2]),
      newStart: Number(match[3]),
      newLines: match[4] === undefined ? 1 : Number(match[4]),
    });
  }
  return spans;
}

/**
 * A hunk is "ambiguous" for a range when remapping cannot be a clean shift:
 * its old-side window intersects the range, or it is a pure insertion whose
 * insertion point falls strictly inside the range (a shift would have to
 * split it).
 */
function hunkAmbiguousFor(range: LineRange, hunk: HunkSpan): boolean {
  if (hunk.oldLines === 0) {
    // Pure insertion after old line `oldStart`.
    return hunk.oldStart >= range.start && hunk.oldStart < range.end;
  }
  const hunkEnd = hunk.oldStart + hunk.oldLines - 1;
  return hunk.oldStart <= range.end && hunkEnd >= range.start;
}

/** True when the whole hunk sits before the range (its delta applies). */
function hunkBefore(range: LineRange, hunk: HunkSpan): boolean {
  if (hunk.oldLines === 0) {
    // Insertion after old line `oldStart` shifts lines > oldStart.
    return hunk.oldStart < range.start;
  }
  return hunk.oldStart + hunk.oldLines - 1 < range.start;
}

/**
 * Remap old-side ranges through the file's hunks. All-or-nothing: ANY
 * ambiguous range demotes the whole call — a partially-remapped chunk would
 * mix coordinate systems.
 */
export function remapRanges(
  ranges: readonly LineRange[],
  hunks: readonly HunkSpan[],
): RemapResult {
  const remapped: LineRange[] = [];
  for (const range of ranges) {
    let offset = 0;
    for (const hunk of hunks) {
      if (hunkAmbiguousFor(range, hunk)) {
        return {
          outcome: RemapOutcomes.DEMOTED,
          reason: `hunk @@ -${hunk.oldStart},${hunk.oldLines} overlaps carried range ${range.start}-${range.end}`,
        };
      }
      if (hunkBefore(range, hunk)) {
        offset += hunk.newLines - hunk.oldLines;
      }
    }
    remapped.push({ start: range.start + offset, end: range.end + offset });
  }
  return { outcome: RemapOutcomes.REMAPPED, ranges: remapped };
}

/** Convenience: remap through a raw per-file patch's hunk headers. */
export function remapThroughPatch(
  ranges: readonly LineRange[],
  patch: string,
): RemapResult {
  return remapRanges(ranges, parseHunkSpans(patch));
}
