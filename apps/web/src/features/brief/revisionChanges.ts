import type {
  Brief,
  BriefChunk,
  DiffLine,
  LineRange,
  RevisionChanges,
} from "./types";

/**
 * The full-brief revision-changes overlay (ADR 0021): join the shared,
 * mechanical prevHead→head changed-line set onto a chunk's base→head diff rows
 * by head line number (added/context) or old line number (deletions), group the
 * marked rows into contiguous runs, and — opportunistically — bind a run to the
 * matching Delta change-group summary when a delta is loaded.
 *
 * Pure; the marks never depend on the (optional) delta narrative.
 */

export type RevisionRowKind = "added" | "removed";

export interface RevisionRun {
  chunkId: string;
  file: string;
  /** Inclusive indexes into `chunk.diff` for this contiguous run. */
  rowIndexes: number[];
  /** "added" if the run contains any added/changed row (incl. modifications); */
  /** "removed" only when the run is a standalone deletion (case B). */
  kind: RevisionRowKind;
}

export interface ChunkRevisionView {
  /** Per diff-row index → why it is marked (drives tint + tag). */
  marks: Map<number, RevisionRowKind>;
  /** Contiguous runs (one focusable rail each). */
  runs: RevisionRun[];
  /** diff-row index → its run, for cheap per-row lookup while rendering. */
  runByRow: Map<number, RevisionRun>;
}

export interface RevisionCallout {
  available: boolean;
  groupTitle?: string;
  summary?: string;
}

function lineInRanges(line: number | undefined, ranges: LineRange[]): boolean {
  return (
    typeof line === "number" &&
    ranges.some((range) => line >= range.start && line <= range.end)
  );
}

/**
 * Mark each diff row of a chunk that changed in this revision: add/context rows
 * by head line (`newLine` ∈ addedRanges), del rows by old line
 * (`oldLine` ∈ removedRanges). Returns an empty map when there is no sidecar or
 * the file is untouched this revision (first brief, etc.).
 */
export function markRevisionRows(
  chunk: BriefChunk,
  rc: RevisionChanges | null,
): Map<number, RevisionRowKind> {
  const marks = new Map<number, RevisionRowKind>();
  if (!rc || !chunk.diff) return marks;
  const file = rc.files.find((entry) => entry.file === chunk.file);
  if (!file) return marks;
  chunk.diff.forEach((row, index) => {
    if (
      (row.kind === "add" || row.kind === "ctx") &&
      lineInRanges(row.newLine, file.addedRanges)
    ) {
      marks.set(index, "added");
    } else if (
      row.kind === "del" &&
      lineInRanges(row.oldLine, file.removedRanges)
    ) {
      marks.set(index, "removed");
    }
  });
  return marks;
}

/**
 * Collapse marked rows into contiguous runs (one rail per run). A run that
 * contains any added row reads as "added" (covers a modification's del+add
 * pair — the new side carries it); a run of only removed rows is a standalone
 * deletion ("removed", case B).
 */
export function groupRevisionRuns(
  chunk: BriefChunk,
  marks: Map<number, RevisionRowKind>,
): RevisionRun[] {
  if (!chunk.diff || marks.size === 0) return [];
  const runs: RevisionRun[] = [];
  let current: { rowIndexes: number[]; hasAdded: boolean; end: number } | null =
    null;
  for (let index = 0; index < chunk.diff.length; index += 1) {
    const kind = marks.get(index);
    if (kind === undefined) {
      current = null;
      continue;
    }
    if (current && index === current.end + 1) {
      current.rowIndexes.push(index);
      current.end = index;
      current.hasAdded ||= kind === "added";
    } else {
      current = { rowIndexes: [index], hasAdded: kind === "added", end: index };
      runs.push({
        chunkId: chunk.id,
        file: chunk.file,
        rowIndexes: current.rowIndexes,
        kind: kind,
      });
    }
    const run = runs.at(-1);
    if (run) run.kind = current.hasAdded ? "added" : "removed";
  }
  return runs;
}

export function buildChunkRevisionView(
  chunk: BriefChunk,
  rc: RevisionChanges | null,
): ChunkRevisionView {
  const marks = markRevisionRows(chunk, rc);
  const runs = groupRevisionRuns(chunk, marks);
  const runByRow = new Map<number, RevisionRun>();
  for (const run of runs) {
    for (const index of run.rowIndexes) runByRow.set(index, run);
  }
  return { marks, runs, runByRow };
}

/**
 * Opportunistic callout content for a run: the Delta change-group it belongs to,
 * when a `(prevHead, head)` delta is loaded. Added runs match a delta chunk on
 * head line; removed runs on old line. Absent delta or no match → unavailable,
 * and the rail still renders (marks never depend on this).
 */
export function bindCallout(
  run: RevisionRun,
  chunk: BriefChunk,
  delta: Brief | null,
): RevisionCallout {
  if (!delta || !chunk.diff) return { available: false };
  const rows = run.rowIndexes
    .map((index) => chunk.diff?.[index])
    .filter((row): row is DiffLine => row !== undefined);
  const headLines = rows
    .map((row) => row.newLine)
    .filter((line): line is number => typeof line === "number");
  const oldLines = rows
    .map((row) => row.oldLine)
    .filter((line): line is number => typeof line === "number");
  const deltaChunk = delta.chunks.find(
    (candidate) =>
      candidate.file === run.file &&
      (headLines.some((line) => lineInRanges(line, candidate.addedRanges)) ||
        oldLines.some((line) => lineInRanges(line, candidate.removedRanges))),
  );
  if (!deltaChunk) return { available: false };
  const group = delta.changeGroups.find(
    (candidate) => candidate.id === deltaChunk.changeGroupId,
  );
  if (!group) return { available: false };
  return {
    available: true,
    groupTitle: group.title,
    summary: deltaChunk.summary ?? group.summary,
  };
}
