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

/** One file's parsed `@@` spans inside a hop. */
export interface FileHunkSpans {
  readonly file: string;
  readonly hunks: readonly HunkSpan[];
}

/**
 * One push's durable hop: the spans of every file that push touched. A file
 * with no entry is read as untouched, so the writer owes two things — a
 * renamed file listed under its OLD path (zero hunks is enough), and `null`
 * instead of a hop whose file list may be incomplete (truncated compare,
 * force-push, retarget).
 */
export type Hop = readonly FileHunkSpans[];

function demoted(reason: string): RemapResult {
  return { outcome: RemapOutcomes.DEMOTED, reason };
}

/**
 * Compose a chain of hops (oldest → newest) into one remap for ONE anchor's
 * ranges — the reviewer may have missed several pushes. A hop carries no
 * entry for files it did not touch, so those pass through unchanged; the
 * first hop that demotes ends the chain. Deliberately more conservative than
 * a direct prev→newest span: a range touched then reverted demotes.
 */
export function remapThroughHops(
  file: string,
  ranges: readonly LineRange[],
  hops: readonly (Hop | null | undefined)[],
): RemapResult {
  if (hops.length === 0) return demoted("no hops: nothing places this anchor");

  let current = ranges;
  for (const hop of hops) {
    // An empty parse is indistinguishable from a failed one, and an empty
    // push from a missing hop row.
    if (!hop || hop.length === 0) {
      return demoted("missing or empty hop in the chain");
    }
    const entry = hop.find((candidate) => candidate.file === file);
    if (entry === undefined) continue;
    if (entry.hunks.length === 0) {
      return demoted(`no spans parsed for ${file}: not evidence`);
    }
    const result = remapRanges(current, entry.hunks);
    if (result.outcome === RemapOutcomes.DEMOTED) return result;
    current = result.ranges;
  }
  return { outcome: RemapOutcomes.REMAPPED, ranges: current };
}
