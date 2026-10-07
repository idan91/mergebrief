/**
 * Revision-changes sidecar: the mechanical prevHead→head changed-line ranges per
 * file, parsed straight from a unified diff, no model call. The full-brief view
 * joins these onto its head-line diff rows to mark what is new in this revision.
 * Absent on the first brief (no previous head).
 */
import { splitDiffByFile, type FileDiff } from "./file-diff";
import { isAddedRow, isRemovedRow, parsePatchRows } from "./patch-rows";
import type { LineRange } from "../types";

export interface RevisionChangeFile {
  file: string;
  /** Added/changed lines in head (new-side) coords, the FE join key. */
  addedRanges: LineRange[];
  /** Removed lines in prevHead (old-side) coords. */
  removedRanges: LineRange[];
}

export interface RevisionChanges {
  headSha: string;
  prevHeadSha: string;
  /** Brief index of the previous head (this brief's index − 1). */
  prevIndex: number;
  files: RevisionChangeFile[];
}

/** Collapse an ascending list of line numbers into inclusive ranges. */
function coalesce(lines: number[]): LineRange[] {
  const ranges: LineRange[] = [];
  for (const n of lines) {
    const last = ranges.at(-1);
    if (last && n === last.end + 1) {
      last.end = n;
    } else {
      ranges.push({ start: n, end: n });
    }
  }
  return ranges;
}

/** Added lines in new-side coords and removed lines in old-side coords. */
function parsePatch(patch: string): { added: number[]; removed: number[] } {
  const added: number[] = [];
  const removed: number[] = [];
  for (const row of parsePatchRows(patch)) {
    if (isAddedRow(row) && row.newLine !== undefined) {
      added.push(row.newLine);
    }
    if (isRemovedRow(row) && row.oldLine !== undefined) {
      removed.push(row.oldLine);
    }
  }
  return { added, removed };
}

/**
 * Per-file added/removed ranges from already-split per-file patches; files
 * with no change drop out. Callers that have run `splitDiffByFile` for
 * another sidecar (e.g. the delta per-file diffs) feed the split here rather
 * than re-scanning the raw diff text.
 */
export function changedRangesFromFileDiffs(
  fileDiffs: FileDiff[],
): RevisionChangeFile[] {
  return fileDiffs.flatMap((fileDiff) => {
    const { added, removed } = parsePatch(fileDiff.patch);
    if (added.length === 0 && removed.length === 0) {
      return [];
    }
    return [
      {
        file: fileDiff.file,
        addedRanges: coalesce(added),
        removedRanges: coalesce(removed),
      },
    ];
  });
}

/** Per-file added/removed ranges for a unified diff; files with no change drop out. */
export function parseChangedRanges(diff: string): RevisionChangeFile[] {
  return changedRangesFromFileDiffs(splitDiffByFile(diff));
}

function rangeLength(range: LineRange): number {
  return range.end - range.start + 1;
}

/**
 * Total changed lines (added + removed, both sides) across a whole unified diff
 * and the size signal the huge-span fallback compares spans with.
 */
export function countChangedLines(diff: string): number {
  return parseChangedRanges(diff).reduce(
    (sum, file) =>
      sum +
      file.addedRanges.reduce((s, r) => s + rangeLength(r), 0) +
      file.removedRanges.reduce((s, r) => s + rangeLength(r), 0),
    0,
  );
}

export function buildRevisionChanges(
  headSha: string,
  prevHeadSha: string,
  prevIndex: number,
  diff: string,
): RevisionChanges {
  return { headSha, prevHeadSha, prevIndex, files: parseChangedRanges(diff) };
}
