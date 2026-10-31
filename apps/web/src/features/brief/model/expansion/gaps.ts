// Hunk-edge expansion, pure. A chunk's rows are a SLICE of the file's diff,
// so the gaps between them are not always hunk boundaries: every edge here
// is named by an insertion point into the rows the chunk actually carries.
import type { LineRange } from "brief-core/types";
import {
  ExpansionDirections,
  type ExpansionDirection,
  type ExpansionEdge,
  type ExpansionGap,
} from "brief-core/chunk-layout";
import { DiffLineKinds } from "types/diff-lines";
import { type DiffLine, DiffRowOrigins } from "@web/utils/diffTokens/types";
import {
  type ExpansionApplication,
  type FileRangeSlice,
  type ResolveExpansionRangeParams,
  type SpliceExpandedRowsParams,
} from "./types";
import { collectExpansionRows } from "./rows";

/** Lines one click reads; a gap with no more than this left opens whole. */
export const EXPAND_STEP = 20;

/** The widest range covering both; a repeat read leaves it unchanged. */
export function unionExpanded(
  current: LineRange | undefined,
  added: LineRange,
): LineRange {
  if (current === undefined) {
    return added;
  }

  return {
    start: Math.min(current.start, added.start),
    end: Math.max(current.end, added.end),
  };
}

/** What every edge key of one chunk starts with. */
export function formatChunkEdgePrefix(chunkId: string): `${string}:` {
  return `${chunkId}:`;
}

/**
 * The state key for one edge of one chunk. `edge` is one found in the chunk's
 * BASE rows: a splice moves every index after it, so a key derived from
 * spliced rows names a different edge on every click.
 */
export function formatExpansionKey(
  chunkId: string,
  edge: ExpansionEdge,
): string {
  return `${formatChunkEdgePrefix(chunkId)}${String(edge.rowIndex)}:${edge.direction}`;
}

/**
 * The range this click reads: one step from the edge, the whole remainder
 * where a step or less is left, and nothing at all where the reader has
 * already reached the gap's end or what the other edge read.
 */
export function resolveExpansionRange(
  params: ResolveExpansionRangeParams,
): LineRange | undefined {
  const direction = params.gap.edge.direction;
  const remaining = resolveRemaining(params.gap, params.expanded);
  if (remaining === undefined) {
    return undefined;
  }

  const bounded = applyStopRule(remaining, direction, params.blocked ?? []);
  if (bounded === undefined) {
    return undefined;
  }

  return takeStep(bounded, direction);
}

/**
 * The chunk's rows with the read's lines spliced in at the edge. Lines the
 * chunk already carries and lines past the gap are dropped, so no line is
 * ever rendered twice.
 *
 * `gap.edge.rowIndex` indexes the rows PASSED IN, so applying several edges
 * by hand must go bottom-up or a later index lands in the wrong place.
 * `spliceAllExpandedRows` is the way to apply more than one.
 */
export function spliceExpandedRows(
  params: SpliceExpandedRowsParams,
): DiffLine[] {
  const { diff, gap, slice } = params;
  const limit = gap.end ?? Number.POSITIVE_INFINITY;
  const bounded = {
    start: Math.max(slice.start, gap.start),
    end: Math.min(slice.end, limit),
  };
  if (bounded.start > bounded.end) {
    return [...diff];
  }

  const rows =
    params.fileRows === undefined
      ? buildExpandedRows(bounded, slice, gap.offset)
      : collectExpansionRows({
          fileRows: params.fileRows,
          range: bounded,
          gapStart: gap.start,
          base: diff,
          slice,
        });
  if (rows.length === 0) {
    return [...diff];
  }

  const index = gap.edge.rowIndex;
  const next = [...diff.slice(0, index), ...rows, ...diff.slice(index)];
  const covered = {
    start: bounded.start,
    end: params.coveredTo ?? bounded.end,
  };
  if (!closesGap(gap, covered)) {
    return next;
  }

  return dropSeamHeader(next, index, rows.length, gap.edge.direction);
}

/**
 * Every edge's read applied to one chunk. The two edges of one gap are
 * reconciled first: the upward read starts after the downward one ends, and
 * reads that meet close the gap between them so the seam header drops. Each
 * edge keeps its own offset: the run below a gap can open on deletions the
 * run above knows nothing about. Then bottom-up, so each edge's index still
 * addresses the rows it was found in; where two edges share an index the
 * upward one goes first.
 */
export function spliceAllExpandedRows(
  diff: readonly DiffLine[],
  entries: readonly ExpansionApplication[],
): DiffLine[] {
  const ordered = reconcileGaps(entries).toSorted(compareApplications);
  let rows = [...diff];

  for (const entry of ordered) {
    const params: SpliceExpandedRowsParams = {
      diff: rows,
      gap: entry.gap,
      slice: entry.slice,
    };
    if (entry.fileRows !== undefined) {
      params.fileRows = entry.fileRows;
    }
    if (entry.coveredTo !== undefined) {
      params.coveredTo = entry.coveredTo;
    }
    rows = spliceExpandedRows(params);
  }

  return rows;
}

function reconcileGaps(
  entries: readonly ExpansionApplication[],
): ExpansionApplication[] {
  const reconciled: ExpansionApplication[] = [];
  const merged = new Set<ExpansionApplication>();

  for (const entry of entries) {
    if (merged.has(entry)) {
      continue;
    }
    const sibling = entries.find(
      (candidate) => candidate !== entry && isSameGap(candidate.gap, entry.gap),
    );
    if (sibling === undefined) {
      reconciled.push(entry);
      continue;
    }
    merged.add(sibling);
    const down = isDownward(entry) ? entry : sibling;
    const up = isDownward(entry) ? sibling : entry;
    reconciled.push(...joinGapReads(down, up));
  }

  return reconciled;
}

function isSameGap(left: ExpansionGap, right: ExpansionGap): boolean {
  const mirrored =
    left.edge.direction !== right.edge.direction &&
    left.start === right.start &&
    left.end === right.end;
  return mirrored;
}

function isDownward(entry: ExpansionApplication): boolean {
  return entry.gap.edge.direction === ExpansionDirections.DOWN;
}

/** The upward read clipped to start after the downward one; reads that meet close the gap. */
function joinGapReads(
  down: ExpansionApplication,
  up: ExpansionApplication,
): ExpansionApplication[] {
  const upStart = Math.max(up.slice.start, down.slice.end + 1);
  const clipped = { ...up, slice: sliceRange(up.slice, upStart, up.slice.end) };
  const meet = down.slice.end + 1 >= up.slice.start;
  const covers =
    down.gap.end !== undefined &&
    down.slice.start <= down.gap.start &&
    up.slice.end >= down.gap.end;
  if (!meet || !covers) {
    return [down, clipped];
  }

  return [{ ...down, coveredTo: up.slice.end }, clipped];
}

function sliceRange(
  slice: FileRangeSlice,
  start: number,
  end: number,
): FileRangeSlice {
  if (start > end) {
    return { start, end, lines: [] };
  }

  return {
    start,
    end,
    lines: slice.lines.slice(start - slice.start, end - slice.start + 1),
  };
}

function compareApplications(
  left: ExpansionApplication,
  right: ExpansionApplication,
): number {
  const byIndex = right.gap.edge.rowIndex - left.gap.edge.rowIndex;
  if (byIndex !== 0) {
    return byIndex;
  }

  return (
    rankDirection(left.gap.edge.direction) -
    rankDirection(right.gap.edge.direction)
  );
}

function rankDirection(direction: ExpansionDirection): number {
  return direction === ExpansionDirections.UP ? 0 : 1;
}

function resolveRemaining(
  gap: ExpansionGap,
  expanded: LineRange | undefined,
): LineRange | undefined {
  const range =
    gap.edge.direction === ExpansionDirections.DOWN
      ? resolveRemainingBelow(gap, expanded)
      : resolveRemainingAbove(gap, expanded);
  if (range.start > range.end) {
    return undefined;
  }

  return range;
}

function resolveRemainingBelow(
  gap: ExpansionGap,
  expanded: LineRange | undefined,
): LineRange {
  const start = expanded === undefined ? gap.start : expanded.end + 1;
  // An open-ended tail has no known last line, so it can only ever take one
  // step: the read itself reports where the file ends.
  const end = gap.end ?? start + EXPAND_STEP - 1;

  return { start, end };
}

function resolveRemainingAbove(
  gap: ExpansionGap,
  expanded: LineRange | undefined,
): LineRange {
  const end =
    expanded === undefined ? (gap.end ?? gap.start) : expanded.start - 1;

  return { start: gap.start, end };
}

function applyStopRule(
  range: LineRange,
  direction: ExpansionDirection,
  blocked: readonly LineRange[],
): LineRange | undefined {
  if (range.start > range.end) {
    return undefined;
  }
  const bounded =
    direction === ExpansionDirections.DOWN
      ? stopBelow(range, blocked)
      : stopAbove(range, blocked);
  if (bounded.start > bounded.end) {
    return undefined;
  }

  return bounded;
}

function stopBelow(range: LineRange, blocked: readonly LineRange[]): LineRange {
  let end = range.end;

  for (const block of blocked) {
    const disjoint = block.end < range.start || block.start > end;
    if (disjoint) {
      continue;
    }
    end = Math.min(end, block.start - 1);
  }

  return { start: range.start, end };
}

function stopAbove(range: LineRange, blocked: readonly LineRange[]): LineRange {
  let start = range.start;

  for (const block of blocked) {
    const disjoint = block.start > range.end || block.end < start;
    if (disjoint) {
      continue;
    }
    start = Math.max(start, block.end + 1);
  }

  return { start, end: range.end };
}

function takeStep(range: LineRange, direction: ExpansionDirection): LineRange {
  const span = range.end - range.start + 1;
  if (span <= EXPAND_STEP) {
    return range;
  }
  if (direction === ExpansionDirections.DOWN) {
    return { start: range.start, end: range.start + EXPAND_STEP - 1 };
  }

  return { start: range.end - EXPAND_STEP + 1, end: range.end };
}

function buildExpandedRows(
  range: LineRange,
  slice: FileRangeSlice,
  offset: number,
): DiffLine[] {
  const rows: DiffLine[] = [];

  for (let line = range.start; line <= range.end; line += 1) {
    const content = slice.lines[line - slice.start];
    if (content === undefined) {
      continue;
    }
    rows.push({
      kind: DiffLineKinds.CTX,
      origin: DiffRowOrigins.EXPANDED,
      content,
      oldLine: line + offset,
      newLine: line,
    });
  }

  return rows;
}

function closesGap(gap: ExpansionGap, range: LineRange): boolean {
  if (gap.end === undefined) {
    return false;
  }

  const spansGap = range.start <= gap.start && range.end >= gap.end;
  return spansGap;
}

/**
 * A closed gap has no discontinuity left to announce and the header's counts
 * no longer describe the rows around it, so the row goes rather than gets
 * rewritten into a second claim the diff cannot back.
 */
function dropSeamHeader(
  rows: DiffLine[],
  index: number,
  inserted: number,
  direction: ExpansionDirection,
): DiffLine[] {
  const seam =
    direction === ExpansionDirections.DOWN ? index + inserted : index - 1;
  if (rows[seam]?.kind !== DiffLineKinds.HUNK) {
    return rows;
  }

  return [...rows.slice(0, seam), ...rows.slice(seam + 1)];
}
