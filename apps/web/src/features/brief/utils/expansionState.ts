import { type DiffLine, DiffRowOrigins } from "@web/utils/diffTokens/types";
import type { DiffView } from "@web/components/DiffRows/types";
import {
  type EdgeExpansion,
  type ExpandableEdge,
  type ExpanderStep,
  type ExpansionApplication,
  ExpansionDirections,
  type ExpansionGap,
  type ExpansionWindow,
  type FileRangeSlice,
  type LineRange,
  type ResolveExpansionWindowParams,
  type SpliceStoredEdgesParams,
  type StoredEdge,
} from "../types";
import {
  EXPAND_STEP,
  formatExpansionKey,
  resolveExpansionWindow,
  spliceAllExpandedRows,
} from "./expandRows";
import { countWindowRows } from "./fileWindowRows";

/** The base gaps paired with what the store holds for each, if anything. */
export function collectStoredEdges(
  chunkId: string,
  gaps: readonly ExpansionGap[],
  expandedEdges: ReadonlyMap<string, EdgeExpansion>,
): StoredEdge[] {
  const stored: StoredEdge[] = [];

  for (const gap of gaps) {
    const edgeKey = formatExpansionKey(chunkId, gap.edge);
    const expansion = expandedEdges.get(edgeKey);
    if (expansion !== undefined) stored.push({ gap, edgeKey, expansion });
  }

  return stored;
}

/**
 * Every stored edge spliced into the base rows. The module reconciles the
 * two edges of one hole (the upward read starts after the downward one, and
 * reads that meet drop the seam header) and applies them bottom-up.
 */
export function spliceStoredEdges(params: SpliceStoredEdgesParams): DiffLine[] {
  const applications: ExpansionApplication[] = params.edges.map((edge) => {
    const application: ExpansionApplication = {
      gap: edge.gap,
      range: sliceLines(edge.expansion.range, params.lines),
    };
    if (params.fileRows !== undefined) application.fileRows = params.fileRows;
    return application;
  });

  return spliceAllExpandedRows(params.rows, applications);
}

function sliceLines(
  range: LineRange,
  lines: ReadonlyMap<number, string>,
): FileRangeSlice {
  const content: string[] = [];

  for (let line = range.start; line <= range.end; line += 1) {
    content.push(lines.get(line) ?? "");
  }

  return { from: range.start, to: range.end, lines: content };
}

/**
 * For each spliced row, its index in the base rows, or -1 for an expanded
 * row. Comments, marks and threads are keyed on base indexes; the splice
 * keeps base rows in order and may drop a seam header, nothing else.
 */
export function mapBaseIndexes(
  base: readonly DiffLine[],
  spliced: readonly DiffLine[],
): number[] {
  const indexes: number[] = [];
  let cursor = 0;

  for (const row of spliced) {
    if (row.origin === DiffRowOrigins.EXPANDED) {
      indexes.push(-1);
      continue;
    }
    while (cursor < base.length && base[cursor] !== row) cursor += 1;
    indexes.push(cursor < base.length ? cursor : -1);
    cursor += 1;
  }

  return indexes;
}

/**
 * The spliced gaps matched back to their base gap: a spliced hole is what is
 * left of exactly one base hole, so the direction and containment name it.
 */
export function placeExpandableEdges(
  chunkId: string,
  baseGaps: readonly ExpansionGap[],
  splicedGaps: readonly ExpansionGap[],
  expandedEdges: ReadonlyMap<string, EdgeExpansion>,
  fileEnd?: number,
): ExpandableEdge[] {
  const edges: ExpandableEdge[] = [];

  for (const spliced of splicedGaps) {
    const base = baseGaps.find((candidate) => contains(candidate, spliced));
    if (base === undefined) continue;
    const edgeKey = formatExpansionKey(chunkId, base.edge);
    const edge: ExpandableEdge = {
      rowIndex: spliced.edge.rowIndex,
      gap: base,
      edgeKey,
      expansion: expandedEdges.get(edgeKey),
    };
    const other = baseGaps.find((candidate) => isSameHole(candidate, base));
    const sibling =
      other === undefined
        ? undefined
        : expandedEdges.get(formatExpansionKey(chunkId, other.edge));
    if (sibling !== undefined) edge.sibling = sibling.range;
    if (fileEnd !== undefined) edge.fileEnd = fileEnd;
    edges.push(edge);
  }

  return edges;
}

/** The other edge of the same hole: opposite direction, same lines. */
function isSameHole(left: ExpansionGap, right: ExpansionGap): boolean {
  return (
    left.edge.direction !== right.edge.direction &&
    left.from === right.from &&
    left.to === right.to
  );
}

function contains(outer: ExpansionGap, inner: ExpansionGap): boolean {
  if (outer.edge.direction !== inner.edge.direction) return false;
  if (inner.from < outer.from) return false;
  if (outer.to === undefined) return inner.to === undefined;

  return inner.to !== undefined && inner.to <= outer.to;
}

/**
 * The rows a chunk's stored expansions add, for the height model, counted
 * without building them. Without the file's rows a window counts its lines;
 * the hole's top is taken as the union's start, close enough for an estimate.
 */
export function countExpandedRows(
  expandedEdges: ReadonlyMap<string, EdgeExpansion>,
  chunkId: string,
  base: readonly DiffLine[],
  fileRows: readonly DiffLine[] | undefined,
  view: DiffView,
): number {
  const prefix = `${chunkId}:`;
  let count = 0;

  for (const [edgeKey, expansion] of expandedEdges) {
    if (!edgeKey.startsWith(prefix)) continue;
    const { start, end } = expansion.range;
    if (fileRows === undefined) {
      count += end - start + 1;
      continue;
    }
    count += countWindowRows(
      { fileRows, window: { from: start, to: end }, holeStart: start, base },
      view,
    );
  }

  return count;
}

/** One key for a chunk's whole expansion state; undefined when none. */
export function buildExpansionKey(
  edges: readonly StoredEdge[],
): string | undefined {
  if (edges.length === 0) return undefined;

  return edges
    .map(
      (edge) =>
        `${edge.edgeKey}=${String(edge.expansion.range.start)}-${String(edge.expansion.range.end)}`,
    )
    .join(",");
}

/**
 * What the next click at an edge reads, or undefined when the edge is spent:
 * the hole is closed, the other edge already read up to here, or a read
 * already reached the end of the file.
 */
export function resolveExpanderStep(
  edge: ExpandableEdge,
): ExpanderStep | undefined {
  if (isPastFileEnd(edge)) return undefined;
  const params: ResolveExpansionWindowParams = { gap: edge.gap };
  if (edge.sibling !== undefined) params.blocked = [edge.sibling];
  if (edge.expansion !== undefined) params.expanded = edge.expansion.range;
  const window = resolveExpansionWindow(params);
  if (window === undefined) return undefined;
  const bounded = clampToFileEnd(window, edge);
  if (bounded === undefined) return undefined;
  const span = bounded.to - bounded.from + 1;
  const openEnded =
    edge.gap.to === undefined &&
    edge.gap.edge.direction === ExpansionDirections.DOWN;
  const reachesEnd = edge.fileEnd !== undefined && bounded.to === edge.fileEnd;

  return {
    window: bounded,
    takesAll: openEnded ? reachesEnd : span < EXPAND_STEP,
  };
}

/** Once any read has named the file end, the last step reads exactly to it. */
function clampToFileEnd(
  window: ExpansionWindow,
  edge: ExpandableEdge,
): ExpansionWindow | undefined {
  if (edge.fileEnd === undefined) return window;
  if (edge.gap.edge.direction !== ExpansionDirections.DOWN) return window;
  if (window.from > edge.fileEnd) return undefined;

  return { from: window.from, to: Math.min(window.to, edge.fileEnd) };
}

function isPastFileEnd(edge: ExpandableEdge): boolean {
  if (edge.gap.edge.direction !== ExpansionDirections.DOWN) return false;
  if (edge.fileEnd !== undefined && edge.gap.from > edge.fileEnd) return true;
  const expansion = edge.expansion;
  if (expansion?.totalLines === undefined) return false;

  return expansion.range.end >= expansion.totalLines;
}

/**
 * The lines of a hole a click can still reach: the whole hole, less what
 * each edge already took.
 */
export function resolveReachableLines(
  edges: readonly ExpandableEdge[],
): LineRange[] {
  const first = edges[0];
  if (first === undefined) return [];
  const holeStart = first.gap.from;
  const holeEnd = first.gap.to ?? Number.POSITIVE_INFINITY;
  const reachable: LineRange[] = [];
  const down = edges.find(
    (edge) => edge.gap.edge.direction === ExpansionDirections.DOWN,
  );
  const up = edges.find(
    (edge) => edge.gap.edge.direction === ExpansionDirections.UP,
  );
  if (down !== undefined) {
    const taken = down.expansion?.range;
    const start = taken === undefined ? holeStart : taken.end + 1;
    if (start <= holeEnd) reachable.push({ start, end: holeEnd });
  }
  if (up !== undefined) {
    const taken = up.expansion?.range;
    const end = taken === undefined ? holeEnd : taken.start - 1;
    if (holeStart <= end) reachable.push({ start: holeStart, end });
  }

  return reachable;
}
