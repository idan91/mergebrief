import type { LineRange, RevisionNarrative } from "brief-core/types";
import type { DiffLine } from "@web/utils/diffTokens/types";
import type { Brief, BriefChunk, RevisionChangeFile } from "../types";
import { isUnattributedRemainderChunk } from "../utils/remainder";

/**
 * The full-Brief comparison overlay: join a baseline's mechanical changed-line
 * set onto a chunk's base→head diff rows (head line for added/context, old
 * line for deletions), group the marked rows into contiguous runs, and bind
 * each run to callout content behind a per-baseline adapter.
 *
 * Pure; highlighting comes ONLY from the mechanical marks; a run's callout is
 * additive and never decides which lines are marked.
 */

export type ComparisonRowKind = "added" | "removed";

/**
 * @description The minimal mechanical-marks shape the row-join needs: per-file
 * changed ranges. Both `ComparisonMarks` (`.comparison.json`, either baseline)
 * and the legacy `RevisionChanges` sidecar satisfy it, so one join serves both.
 */
export interface ComparisonMarkFiles {
  files: RevisionChangeFile[];
}

export interface ComparisonRun {
  chunkId: string;
  file: string;
  /**
   * @description Inclusive indexes into `chunk.diff` for this contiguous run.
   */
  rowIndexes: number[];
  /**
   * @description `added` if the run contains any added/changed row, including modifications.
   * `removed` only when the run is a standalone deletion (case B).
   */
  kind: ComparisonRowKind;
}

export interface ChunkComparisonView {
  /**
   * @description Per diff-row index to why it is marked; drives tint and tag.
   */
  marks: Map<number, ComparisonRowKind>;
  /**
   * @description Contiguous runs, one focusable rail each.
   */
  runs: ComparisonRun[];
  /**
   * @description Diff-row index to its run, for cheap per-row lookup while rendering.
   */
  runByRow: Map<number, ComparisonRun>;
}

export interface ComparisonCalloutContent {
  available: boolean;
  groupTitle?: string;
  /**
   * Remainder rows title themselves at render (`remainderTitle`) so this
   * binder stays locale-free.
   */
  remainder?: true;
  summary?: string;
  /**
   * @description True when the span has no narrative coverage and the content
   * degraded to the full Brief's chunk/group at that head line; the callout
   * renders, with a note that the span summary is missing.
   */
  degraded?: boolean;
}

/**
 * @description The narrative source a run's callout binds against, discriminated
 * by the active Compare baseline. `previous-brief` resolves the title from the
 * *full Brief's* Change-group (the taxonomy owner) and the body from the
 * Revision narrative chunk; `last-review` reuses the existing Delta matching
 * logic behind an adapter, deliberately not unified, to keep the Delta
 * boundary honest.
 */
export type ComparisonSource =
  | {
      kind: "previous-brief";
      brief: Brief;
      narrative: RevisionNarrative | null;
    }
  | { kind: "last-review"; delta: Brief | null };

function lineInRanges(line: number | undefined, ranges: LineRange[]): boolean {
  return (
    typeof line === "number" &&
    ranges.some((range) => line >= range.start && line <= range.end)
  );
}

/**
 * Mark each diff row of a chunk that changed for the selected baseline: add/
 * context rows by head line (`newLine` ∈ addedRanges), del rows by old line
 * (`oldLine` ∈ removedRanges). Returns an empty map when there are no marks or
 * the file is untouched for this baseline.
 */
export function markComparisonRows(
  chunk: BriefChunk,
  marks: ComparisonMarkFiles | null,
): Map<number, ComparisonRowKind> {
  const rows = new Map<number, ComparisonRowKind>();
  if (!marks) {
    return rows;
  }
  // The file check comes first: reading `diff` slices the chunk's rows.
  const file = marks.files.find((entry) => entry.file === chunk.file);
  if (!file || !chunk.diff) {
    return rows;
  }
  chunk.diff.forEach((row, index) => {
    if (
      (row.kind === "add" || row.kind === "ctx") &&
      lineInRanges(row.newLine, file.addedRanges)
    ) {
      rows.set(index, "added");
    } else if (
      row.kind === "del" &&
      lineInRanges(row.oldLine, file.removedRanges)
    ) {
      rows.set(index, "removed");
    }
  });
  return rows;
}

/**
 * Collapse marked rows into contiguous runs (one rail per run). A run that
 * contains any added row reads as "added" (covers a modification's del+add
 * pair, the new side carries it); a run of only removed rows is a standalone
 * deletion ("removed", case B).
 */
export function groupComparisonRuns(
  chunk: BriefChunk,
  marks: Map<number, ComparisonRowKind>,
): ComparisonRun[] {
  if (marks.size === 0 || !chunk.diff) {
    return [];
  }
  const runs: ComparisonRun[] = [];
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
    if (run) {
      run.kind = current.hasAdded ? "added" : "removed";
    }
  }
  return runs;
}

export function buildChunkComparisonView(
  chunk: BriefChunk,
  marks: ComparisonMarkFiles | null,
): ChunkComparisonView {
  const rowMarks = markComparisonRows(chunk, marks);
  const runs = groupComparisonRuns(chunk, rowMarks);
  const runByRow = new Map<number, ComparisonRun>();
  for (const run of runs) {
    for (const index of run.rowIndexes) {
      runByRow.set(index, run);
    }
  }
  return { marks: rowMarks, runs, runByRow };
}

/**
 * The rail button's behavioral attribute: rendered by RevisionGutterCell,
 * queried by revision navigation. Exported constant per the repo rule for
 * runtime-queried attributes, never a bare literal at a query site.
 */
export const REVISION_JUMP_ATTR = "data-jump-target";

/** Selector for one rail (by key) or all rails (no key). */
export function revisionJumpSelector(railKey?: string): string {
  if (railKey === undefined) {
    return `[${REVISION_JUMP_ATTR}]`;
  }
  return `[${REVISION_JUMP_ATTR}="${CSS.escape(railKey)}"]`;
}

/** Stable identity for one rail button, shared by the DOM attribute the
 * gutter renders and the model-derived jump-target list. */
export function comparisonRunKey(run: ComparisonRun): string {
  return `${run.file}#${run.chunkId}:${String(run.rowIndexes[0] ?? 0)}`;
}

export interface RevisionJumpTarget {
  chunkId: string;
  railKey: string;
}

/**
 * Every rail in RENDERED order, derived from the model rather than the DOM:
 * windowed chunk lists only mount viewport-adjacent cards, so a DOM
 * enumeration silently skips every rail in an unmounted chunk.
 */
export function deriveRevisionJumpTargets(
  chunks: readonly BriefChunk[],
  marks: ComparisonMarkFiles | null,
): RevisionJumpTarget[] {
  if (!marks) {
    return [];
  }
  return chunks.flatMap((chunk) =>
    buildChunkComparisonView(chunk, marks).runs.map((run) => ({
      chunkId: chunk.id,
      railKey: comparisonRunKey(run),
    })),
  );
}

function runLines(
  run: ComparisonRun,
  chunk: BriefChunk,
): { headLines: number[]; oldLines: number[] } {
  const rows = run.rowIndexes
    .map((index) => chunk.diff?.[index])
    .filter((row): row is DiffLine => row !== undefined);
  const headLines = rows
    .map((row) => row.newLine)
    .filter((line): line is number => typeof line === "number");
  const oldLines = rows
    .map((row) => row.oldLine)
    .filter((line): line is number => typeof line === "number");
  return { headLines, oldLines };
}

/**
 * Degraded fallback: the run lives inside a full-Brief chunk's rendered diff,
 * so when the narrative under-covers the span the callout falls back to that
 * chunk's own Change-group: group title plus the chunk's summary (or the
 * group's, mirroring the Delta adapter's `??`). A removed run gets NO summary:
 * summaries describe the net base→head change and would misdescribe a
 * deletion under the "Removed this revision" eyebrow, so group title plus the
 * degraded note is the floor. Only a broken group reference stays unavailable.
 */
function bindBriefChunkFallback(
  run: ComparisonRun,
  chunk: BriefChunk,
  brief: Brief,
): ComparisonCalloutContent {
  if (isUnattributedRemainderChunk(chunk)) {
    return bindRemainderFallback(run, chunk);
  }
  const group = brief.changeGroups.find(
    (candidate) => candidate.id === chunk.changeGroupId,
  );
  if (!group) {
    return { available: false };
  }
  if (run.kind === "removed") {
    return { available: true, degraded: true, groupTitle: group.title };
  }
  return {
    available: true,
    degraded: true,
    groupTitle: group.title,
    summary: chunk.summary ?? group.summary,
  };
}

function bindRemainderFallback(
  run: ComparisonRun,
  chunk: BriefChunk,
): ComparisonCalloutContent {
  if (run.kind === "removed") {
    return { available: true, degraded: true, remainder: true };
  }
  const content: ComparisonCalloutContent = {
    available: true,
    degraded: true,
    remainder: true,
  };
  if (chunk.summary !== undefined) {
    content.summary = chunk.summary;
  }
  return content;
}

/**
 * Previous-Brief callout: title from the full Brief's Change-group, body from
 * the matching Revision narrative chunk summary. Degrades honestly: no
 * narrative at all (null / failed) → unavailable; no chunk matching the span →
 * degraded fallback to the full Brief's own chunk/group; a matched chunk whose
 * `briefChangeGroupId` is not in the rendered Brief keeps its span summary
 * under the chunk's own group title. Marks never depend on any of this.
 */
export function bindRevisionNarrativeCallout(
  run: ComparisonRun,
  chunk: BriefChunk,
  brief: Brief,
  narrative: RevisionNarrative | null,
): ComparisonCalloutContent {
  if (!narrative || !chunk.diff) {
    return { available: false };
  }
  const { headLines, oldLines } = runLines(run, chunk);
  const narrativeChunk = narrative.chunks.find(
    (candidate) =>
      candidate.file === run.file &&
      (headLines.some((line) => lineInRanges(line, candidate.addedRanges)) ||
        oldLines.some((line) => lineInRanges(line, candidate.removedRanges))),
  );
  if (isUnattributedRemainderChunk(chunk)) {
    if (!narrativeChunk) {
      return bindRemainderFallback(run, chunk);
    }
    return {
      available: true,
      remainder: true,
      summary: narrativeChunk.summary,
    };
  }
  if (!narrativeChunk) {
    return bindBriefChunkFallback(run, chunk, brief);
  }
  const group = brief.changeGroups.find(
    (candidate) => candidate.id === narrativeChunk.briefChangeGroupId,
  );
  if (!group) {
    // Dangling `briefChangeGroupId`: the span summary itself is real, keep
    // it, titled by the chunk's own group, instead of dropping the callout.
    // Not `degraded`: that note would claim the span summary is unavailable
    // while showing it.
    const ownGroup = brief.changeGroups.find(
      (candidate) => candidate.id === chunk.changeGroupId,
    );
    if (!ownGroup) {
      return { available: false };
    }
    return {
      available: true,
      groupTitle: ownGroup.title,
      summary: narrativeChunk.summary,
    };
  }
  return {
    available: true,
    groupTitle: group.title,
    summary: narrativeChunk.summary,
  };
}

/**
 * Your-last-review callout: the existing Delta matching logic, preserved behind
 * this adapter rather than rewritten. Added runs match a Delta chunk on head
 * line; removed runs on old line. Absent Delta or no match → unavailable.
 */
export function bindDeltaCallout(
  run: ComparisonRun,
  chunk: BriefChunk,
  delta: Brief | null,
): ComparisonCalloutContent {
  if (!delta || !chunk.diff) {
    return { available: false };
  }
  const { headLines, oldLines } = runLines(run, chunk);
  const deltaChunk = delta.chunks.find(
    (candidate) =>
      candidate.file === run.file &&
      (headLines.some((line) => lineInRanges(line, candidate.addedRanges)) ||
        oldLines.some((line) => lineInRanges(line, candidate.removedRanges))),
  );
  if (!deltaChunk) {
    return { available: false };
  }
  const group = delta.changeGroups.find(
    (candidate) => candidate.id === deltaChunk.changeGroupId,
  );
  if (!group) {
    return { available: false };
  }
  return {
    available: true,
    groupTitle: group.title,
    summary: deltaChunk.summary ?? group.summary,
  };
}

/** Resolve a run's callout content from the active narrative source (adapter). */
export function bindComparisonCallout(
  run: ComparisonRun,
  chunk: BriefChunk,
  source: ComparisonSource,
): ComparisonCalloutContent {
  return source.kind === "previous-brief"
    ? bindRevisionNarrativeCallout(run, chunk, source.brief, source.narrative)
    : bindDeltaCallout(run, chunk, source.delta);
}
