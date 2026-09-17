// Hunk-edge expansion, pure. A chunk's rows are a SLICE of the file's diff,
// so the gaps between them are not always hunk boundaries: every edge here
// is named by an insertion point into the rows the chunk actually carries.
import {
  type DiffLine,
  DiffLineKinds,
  DiffRowOrigins,
} from "@web/utils/diffTokens/types";
import {
  type ExpansionApplication,
  type ExpansionDirection,
  ExpansionDirections,
  type ExpansionEdge,
  type ExpansionGap,
  type ExpansionRange,
  type FileRangeSlice,
  type LineRange,
  type ResolveExpansionRangeParams,
  type SpliceExpandedRowsParams,
} from "../types";
import { collectExpansionRows } from "./expansion-rows";

/** Lines one click reads; a gap with no more than this left opens whole. */
export const EXPAND_STEP = 20;

const HUNK_HEADER =
  /^@@ -(?<oldStart>\d+)(?:,\d+)? \+(?<newStart>\d+)(?:,\d+)? @@/;

interface NewSideAnchor {
  index: number;
  newLine: number;
}

/** The widest range covering both; a repeat read leaves it unchanged. */
export function unionExpanded(
  current: LineRange | undefined,
  added: LineRange,
): LineRange {
  if (current === undefined) return added;

  return {
    start: Math.min(current.start, added.start),
    end: Math.max(current.end, added.end),
  };
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
  return `${chunkId}:${String(edge.rowIndex)}:${edge.direction}`;
}

/** Every edge a reader can expand from, in row order. */
export function findExpansionGaps(diff: readonly DiffLine[]): ExpansionGap[] {
  const anchors = listNewSideAnchors(diff);
  const first = anchors[0];
  const last = anchors.at(-1);
  if (first === undefined || last === undefined) return [];

  const trail = traceOffsets(diff);
  const gaps: ExpansionGap[] = [];

  if (first.newLine > 1) {
    const header = diff[0]?.kind === DiffLineKinds.HUNK ? 0 : undefined;
    const runStart = findRunStart(diff, -1, header);
    const edge = { rowIndex: runStart, direction: ExpansionDirections.UP };
    const offset = readRunOffset(diff, runStart, trail);
    gaps.push(shapeGap(edge, 1, first.newLine - 1, offset));
  }

  gaps.push(...findInnerGaps(diff, anchors, trail));

  const tail = { rowIndex: diff.length, direction: ExpansionDirections.DOWN };
  gaps.push(
    shapeGap(
      tail,
      last.newLine + 1,
      undefined,
      readOffset(trail, diff.length - 1),
    ),
  );

  return gaps;
}

/**
 * The range this click reads: one step from the edge, the whole remainder
 * where a step or less is left, and nothing at all where the reader has
 * already reached the gap's end or what the other edge read.
 */
export function resolveExpansionRange(
  params: ResolveExpansionRangeParams,
): ExpansionRange | undefined {
  const direction = params.gap.edge.direction;
  const remaining = resolveRemaining(params.gap, params.expanded);
  if (remaining === undefined) return undefined;

  const bounded = applyStopRule(remaining, direction, params.blocked ?? []);
  if (bounded === undefined) return undefined;

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
  const limit = gap.to ?? Number.POSITIVE_INFINITY;
  const bounded = {
    from: Math.max(slice.from, gap.from),
    to: Math.min(slice.to, limit),
  };
  if (bounded.from > bounded.to) return [...diff];

  const rows =
    params.fileRows === undefined
      ? buildExpandedRows(bounded, slice, gap.offset)
      : collectExpansionRows({
          fileRows: params.fileRows,
          range: bounded,
          gapStart: gap.from,
          base: diff,
          slice,
        });
  if (rows.length === 0) return [...diff];

  const index = gap.edge.rowIndex;
  const next = [...diff.slice(0, index), ...rows, ...diff.slice(index)];
  const covered = { from: bounded.from, to: params.coveredTo ?? bounded.to };
  if (!closesGap(gap, covered)) return next;

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
    if (entry.fileRows !== undefined) params.fileRows = entry.fileRows;
    if (entry.coveredTo !== undefined) params.coveredTo = entry.coveredTo;
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
    if (merged.has(entry)) continue;
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
  return (
    left.edge.direction !== right.edge.direction &&
    left.from === right.from &&
    left.to === right.to
  );
}

function isDownward(entry: ExpansionApplication): boolean {
  return entry.gap.edge.direction === ExpansionDirections.DOWN;
}

/** The upward read clipped to start after the downward one; reads that meet close the gap. */
function joinGapReads(
  down: ExpansionApplication,
  up: ExpansionApplication,
): ExpansionApplication[] {
  const upFrom = Math.max(up.slice.from, down.slice.to + 1);
  const clipped = { ...up, slice: sliceRange(up.slice, upFrom, up.slice.to) };
  const meet = down.slice.to + 1 >= up.slice.from;
  const covers =
    down.gap.to !== undefined &&
    down.slice.from <= down.gap.from &&
    up.slice.to >= down.gap.to;
  if (!meet || !covers) return [down, clipped];

  return [{ ...down, coveredTo: up.slice.to }, clipped];
}

function sliceRange(
  slice: FileRangeSlice,
  from: number,
  to: number,
): FileRangeSlice {
  if (from > to) return { from, to, lines: [] };

  return {
    from,
    to,
    lines: slice.lines.slice(from - slice.from, to - slice.from + 1),
  };
}

function compareApplications(
  left: ExpansionApplication,
  right: ExpansionApplication,
): number {
  const byIndex = right.gap.edge.rowIndex - left.gap.edge.rowIndex;
  if (byIndex !== 0) return byIndex;

  return (
    rankDirection(left.gap.edge.direction) -
    rankDirection(right.gap.edge.direction)
  );
}

function rankDirection(direction: ExpansionDirection): number {
  return direction === ExpansionDirections.UP ? 0 : 1;
}

function findInnerGaps(
  diff: readonly DiffLine[],
  anchors: readonly NewSideAnchor[],
  trail: readonly number[],
): ExpansionGap[] {
  const gaps: ExpansionGap[] = [];

  for (let position = 1; position < anchors.length; position += 1) {
    const above = anchors[position - 1];
    const below = anchors[position];
    if (above === undefined || below === undefined) continue;
    if (below.newLine <= above.newLine + 1) continue;

    const header = findHeaderBetween(diff, above.index, below.index);
    const from = above.newLine + 1;
    const to = below.newLine - 1;
    const runStart = findRunStart(diff, above.index, header);
    const downIndex = header ?? runStart;
    const down = { rowIndex: downIndex, direction: ExpansionDirections.DOWN };
    const up = { rowIndex: runStart, direction: ExpansionDirections.UP };
    gaps.push(shapeGap(down, from, to, readOffset(trail, downIndex - 1)));
    gaps.push(shapeGap(up, from, to, readRunOffset(diff, runStart, trail)));
  }

  return gaps;
}

/**
 * The first row of the run below a gap, whatever its kind: the row after
 * the header, or, with no header, the first row after the run above that is
 * not a deletion continuing the run above's old numbering.
 */
function findRunStart(
  diff: readonly DiffLine[],
  aboveIndex: number,
  header: number | undefined,
): number {
  if (header !== undefined) return header + 1;
  let index = aboveIndex + 1;

  while (index < diff.length) {
    const row = diff[index];
    const previous = diff[index - 1];
    const continues =
      row?.kind === DiffLineKinds.DEL &&
      previous?.oldLine !== undefined &&
      row.oldLine === previous.oldLine + 1;
    if (!continues) break;
    index += 1;
  }

  return index;
}

/**
 * The offset in force at the first row of a run: the run's first row with
 * both numbers states it, walked back one per deletion and one per addition
 * in between. A run with no such row falls back on the trail.
 */
function readRunOffset(
  diff: readonly DiffLine[],
  runStart: number,
  trail: readonly number[],
): number {
  for (let index = runStart; index < diff.length; index += 1) {
    const row = diff[index];
    if (row === undefined || row.kind === DiffLineKinds.HUNK) break;
    const stated = readStatedOffset(row);
    if (stated === undefined) continue;
    let offset = stated;
    for (let back = index - 1; back >= runStart; back -= 1) {
      const crossed = diff[back];
      if (crossed?.kind === DiffLineKinds.ADD) offset += 1;
      if (crossed?.kind === DiffLineKinds.DEL) offset -= 1;
    }
    return offset;
  }

  return readOffset(trail, runStart - 1);
}

function shapeGap(
  edge: ExpansionEdge,
  from: number,
  to: number | undefined,
  offset: number,
): ExpansionGap {
  const gap: ExpansionGap = { edge, from, offset };
  if (to !== undefined) gap.to = to;

  return gap;
}

function listNewSideAnchors(diff: readonly DiffLine[]): NewSideAnchor[] {
  const anchors: NewSideAnchor[] = [];

  diff.forEach((row, index) => {
    if (row.newLine === undefined) return;
    if (row.kind === DiffLineKinds.HUNK) return;
    anchors.push({ index, newLine: row.newLine });
  });

  return anchors;
}

/**
 * `oldLine - newLine` in force after each row. A row carrying both numbers
 * STATES the offset and re-derives it: slicing drops whole runs of another
 * chunk's rows, so a running count alone drifts across every gap.
 */
function traceOffsets(diff: readonly DiffLine[]): number[] {
  const trail: number[] = [];
  let offset = 0;

  for (const row of diff) {
    const header = readHunkOffset(row);
    if (header !== undefined) offset = header;
    const stated = readStatedOffset(row);
    if (stated !== undefined) offset = stated;
    if (row.kind === DiffLineKinds.ADD) offset -= 1;
    if (row.kind === DiffLineKinds.DEL) offset += 1;
    trail.push(offset);
  }

  return trail;
}

function readStatedOffset(row: DiffLine): number | undefined {
  if (row.oldLine === undefined || row.newLine === undefined) return undefined;

  return row.oldLine - row.newLine;
}

function readHunkOffset(row: DiffLine): number | undefined {
  if (row.kind !== DiffLineKinds.HUNK) return undefined;
  const match = HUNK_HEADER.exec(row.content);
  const oldStart = match?.groups?.["oldStart"];
  const newStart = match?.groups?.["newStart"];
  if (oldStart === undefined || newStart === undefined) return undefined;

  return Number(oldStart) - Number(newStart);
}

function readOffset(trail: readonly number[], index: number): number {
  return trail[index] ?? 0;
}

function findHeaderBetween(
  diff: readonly DiffLine[],
  above: number,
  below: number,
): number | undefined {
  for (let index = above + 1; index < below; index += 1) {
    if (diff[index]?.kind === DiffLineKinds.HUNK) return index;
  }

  return undefined;
}

function resolveRemaining(
  gap: ExpansionGap,
  expanded: LineRange | undefined,
): ExpansionRange | undefined {
  const range =
    gap.edge.direction === ExpansionDirections.DOWN
      ? resolveRemainingBelow(gap, expanded)
      : resolveRemainingAbove(gap, expanded);
  if (range.from > range.to) return undefined;

  return range;
}

function resolveRemainingBelow(
  gap: ExpansionGap,
  expanded: LineRange | undefined,
): ExpansionRange {
  const from = expanded === undefined ? gap.from : expanded.end + 1;
  // An open-ended tail has no known last line, so it can only ever take one
  // step: the read itself reports where the file ends.
  const to = gap.to ?? from + EXPAND_STEP - 1;

  return { from, to };
}

function resolveRemainingAbove(
  gap: ExpansionGap,
  expanded: LineRange | undefined,
): ExpansionRange {
  const to = expanded === undefined ? (gap.to ?? gap.from) : expanded.start - 1;

  return { from: gap.from, to };
}

function applyStopRule(
  range: ExpansionRange,
  direction: ExpansionDirection,
  blocked: readonly LineRange[],
): ExpansionRange | undefined {
  if (range.from > range.to) return undefined;
  const bounded =
    direction === ExpansionDirections.DOWN
      ? stopBelow(range, blocked)
      : stopAbove(range, blocked);
  if (bounded.from > bounded.to) return undefined;

  return bounded;
}

function stopBelow(
  range: ExpansionRange,
  blocked: readonly LineRange[],
): ExpansionRange {
  let to = range.to;

  for (const block of blocked) {
    if (block.end < range.from || block.start > to) continue;
    to = Math.min(to, block.start - 1);
  }

  return { from: range.from, to };
}

function stopAbove(
  range: ExpansionRange,
  blocked: readonly LineRange[],
): ExpansionRange {
  let from = range.from;

  for (const block of blocked) {
    if (block.start > range.to || block.end < from) continue;
    from = Math.max(from, block.end + 1);
  }

  return { from, to: range.to };
}

function takeStep(
  range: ExpansionRange,
  direction: ExpansionDirection,
): ExpansionRange {
  const span = range.to - range.from + 1;
  if (span <= EXPAND_STEP) return range;
  if (direction === ExpansionDirections.DOWN) {
    return { from: range.from, to: range.from + EXPAND_STEP - 1 };
  }

  return { from: range.to - EXPAND_STEP + 1, to: range.to };
}

function buildExpandedRows(
  range: ExpansionRange,
  slice: FileRangeSlice,
  offset: number,
): DiffLine[] {
  const rows: DiffLine[] = [];

  for (let line = range.from; line <= range.to; line += 1) {
    const content = slice.lines[line - slice.from];
    if (content === undefined) continue;
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

function closesGap(gap: ExpansionGap, range: ExpansionRange): boolean {
  if (gap.to === undefined) return false;

  return range.from <= gap.from && range.to >= gap.to;
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
  if (rows[seam]?.kind !== DiffLineKinds.HUNK) return rows;

  return [...rows.slice(0, seam), ...rows.slice(seam + 1)];
}
