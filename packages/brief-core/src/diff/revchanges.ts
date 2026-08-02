/**
 * Revision-changes sidecar (ADR 0021): the **mechanical** prevHead→head
 * changed-line ranges per file, parsed straight from a unified diff — **no
 * model call**. The full-brief view joins these onto its head-line diff rows to
 * mark what is new in *this* revision (shared, per-revision, never the
 * per-reviewer Delta Brief). Absent on the first brief (no previous head).
 */
import { splitDiffByFile, type FileDiff } from "./diff";
import type { LineRange } from "../types";

export interface RevisionChangeFile {
  file: string;
  /** Added/changed lines in head (new-side) coords — the FE join key. */
  addedRanges: LineRange[];
  /** Removed lines in prevHead (old-side) coords — deletion case B. */
  removedRanges: LineRange[];
}

export interface RevisionChanges {
  headSha: string;
  prevHeadSha: string;
  /** Brief index of the previous head (this brief's index − 1). */
  prevIndex: number;
  files: RevisionChangeFile[];
}

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/** Collapse an ascending list of line numbers into inclusive ranges. */
function coalesce(lines: number[]): LineRange[] {
  const ranges: LineRange[] = [];
  for (const n of lines) {
    const last = ranges.at(-1);
    if (last && n === last.end + 1) last.end = n;
    else ranges.push({ start: n, end: n });
  }
  return ranges;
}

/**
 * Walk one file's patch, recording added lines in new-side coords and removed
 * lines in old-side coords. Only counts +/- lines **inside a hunk**, so the
 * file-header `---`/`+++`/`diff --git` lines (which begin with -/+) are ignored.
 */
function parsePatch(patch: string): { added: number[]; removed: number[] } {
  const added: number[] = [];
  const removed: number[] = [];
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;
  for (const line of patch.split("\n")) {
    const match = HUNK.exec(line);
    if (match) {
      oldLine = Number(match[1]);
      newLine = Number(match[2]);
      inHunk = true;
      continue;
    }
    if (!inHunk || line === "") continue;
    const marker = line[0];
    if (marker === "+") {
      added.push(newLine);
      newLine++;
    } else if (marker === "-") {
      removed.push(oldLine);
      oldLine++;
    } else if (marker === "\\") {
      // "\ No newline at end of file" — metadata, advances neither side.
      continue;
    } else {
      // context line (incl. a blank " " line): advances both sides.
      oldLine++;
      newLine++;
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
    if (added.length === 0 && removed.length === 0) return [];
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
 * Total changed lines (added + removed, both sides) across a whole unified
 * diff — the cheap size signal the huge-span fallback compares an incremental
 * span against the whole-PR span with (ADR 0006 #7 / ADR 0024).
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
