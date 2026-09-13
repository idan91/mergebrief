import { type DiffLine, DiffLineKinds } from "@web/utils/diffTokens/types";
import {
  type BriefChunk,
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
  const applications: ExpansionApplication[] = params.edges.map((edge) => ({
    gap: edge.gap,
    range: sliceLines(edge.expansion.range, params.lines),
    claimed: params.claimed,
  }));

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
    if (row.kind === DiffLineKinds.EXPANDED_CONTEXT) {
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

/** The rows expansion has added to a chunk, for the height model. */
export function countExpandedLines(
  expandedEdges: ReadonlyMap<string, EdgeExpansion>,
  chunkId: string,
): number {
  const prefix = `${chunkId}:`;
  let count = 0;

  for (const [edgeKey, expansion] of expandedEdges) {
    if (!edgeKey.startsWith(prefix)) continue;
    count += expansion.range.end - expansion.range.start + 1;
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
 * the hole is closed, another chunk's rows sit right behind it, or a read
 * already reached the end of the file.
 */
export function resolveExpanderStep(
  edge: ExpandableEdge,
  claimed: readonly LineRange[],
): ExpanderStep | undefined {
  if (isPastFileEnd(edge)) return undefined;
  const stops =
    edge.sibling === undefined ? claimed : [...claimed, edge.sibling];
  const params: ResolveExpansionWindowParams = {
    gap: edge.gap,
    claimed: stops,
  };
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
 * For each chunk, the head-file lines its sibling chunks of the same file
 * render: one envelope per sibling plus whatever each sibling has expanded.
 * An expansion stops at the first of them, so no line ever shows twice.
 */
export function collectClaimedLines(
  chunks: readonly BriefChunk[],
  expandedEdges: ReadonlyMap<string, EdgeExpansion> = NO_EXPANSIONS,
): ReadonlyMap<string, LineRange[]> {
  const envelopes = new Map<string, LineRange | undefined>();
  for (const chunk of chunks) {
    envelopes.set(chunk.id, resolveNewLineEnvelope(chunk.diff ?? []));
  }
  const claimed = new Map<string, LineRange[]>();

  for (const chunk of chunks) {
    const others: LineRange[] = [];
    for (const sibling of chunks) {
      if (sibling === chunk || sibling.file !== chunk.file) continue;
      const envelope = envelopes.get(sibling.id);
      if (envelope !== undefined) others.push(envelope);
      others.push(...collectExpandedRanges(expandedEdges, sibling.id));
    }
    claimed.set(chunk.id, others);
  }

  return claimed;
}

const NO_EXPANSIONS: ReadonlyMap<string, EdgeExpansion> = new Map();

function collectExpandedRanges(
  expandedEdges: ReadonlyMap<string, EdgeExpansion>,
  chunkId: string,
): LineRange[] {
  const prefix = `${chunkId}:`;
  const ranges: LineRange[] = [];
  for (const [edgeKey, expansion] of expandedEdges) {
    if (edgeKey.startsWith(prefix)) ranges.push(expansion.range);
  }

  return ranges;
}

/** Whether a head-file line sits inside any claimed range. */
export function isClaimedLine(
  line: number,
  claimed: readonly LineRange[],
): boolean {
  return claimed.some((range) => line >= range.start && line <= range.end);
}

function resolveNewLineEnvelope(
  rows: readonly DiffLine[],
): LineRange | undefined {
  let start: number | undefined;
  let end: number | undefined;

  for (const row of rows) {
    if (row.newLine === undefined) continue;
    if (start === undefined || row.newLine < start) start = row.newLine;
    if (end === undefined || row.newLine > end) end = row.newLine;
  }

  return start === undefined || end === undefined ? undefined : { start, end };
}

/**
 * The lines of a hole a click can still reach: from the hole's top down to
 * the first claimed range, and from the last claimed range up to its bottom,
 * less what each edge already took. A thread elsewhere in the hole stays
 * hidden whatever the reader clicks, so it is not counted.
 */
export function resolveReachableLines(
  edges: readonly ExpandableEdge[],
  claimed: readonly LineRange[],
): LineRange[] {
  const first = edges[0];
  if (first === undefined) return [];
  const holeStart = first.gap.from;
  const holeEnd = first.gap.to ?? Number.POSITIVE_INFINITY;
  const blocking = claimed
    .filter((range) => range.end >= holeStart && range.start <= holeEnd)
    .toSorted((left, right) => left.start - right.start);
  let fromTop = { start: holeStart, end: holeEnd };
  let fromBottom = { start: holeStart, end: holeEnd };
  const firstBlock = blocking[0];
  const lastBlock = blocking.at(-1);
  if (firstBlock !== undefined) {
    fromTop = { start: holeStart, end: firstBlock.start - 1 };
  }
  if (lastBlock !== undefined) {
    fromBottom = { start: lastBlock.end + 1, end: holeEnd };
  }

  const reachable: LineRange[] = [];
  const down = edges.find(
    (edge) => edge.gap.edge.direction === ExpansionDirections.DOWN,
  );
  const up = edges.find(
    (edge) => edge.gap.edge.direction === ExpansionDirections.UP,
  );
  if (down !== undefined) {
    const taken = down.expansion?.range;
    const start = taken === undefined ? fromTop.start : taken.end + 1;
    if (start <= fromTop.end) reachable.push({ start, end: fromTop.end });
  }
  if (up !== undefined) {
    const taken = up.expansion?.range;
    const end = taken === undefined ? fromBottom.end : taken.start - 1;
    if (fromBottom.start <= end)
      reachable.push({ start: fromBottom.start, end });
  }

  return reachable;
}
