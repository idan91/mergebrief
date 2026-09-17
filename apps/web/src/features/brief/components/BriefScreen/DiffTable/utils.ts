import { rangeBetween } from "@web/utils/collections";
import {
  type ConversationThread,
  ThreadSides,
} from "@web/features/conversation/types";
import {
  type CommentAnchor,
  type CommentSide,
  CommentSides,
  isLineCommentAnchor,
  type LineCommentAnchor,
  type ReviewComment,
  createCommentAnchor,
  createSideAnchor,
  rowId,
} from "@web/features/review/utils";
import {
  anchorEndsOnRow,
  isCommentableLine,
  type DiffRowView,
} from "./diffRowView";
import type { BriefChunk } from "../../../types";
import { type DiffLine, DiffLineKinds } from "@web/utils/diffTokens/types";
import {
  type LineSide,
  type SplitCell,
  type SplitRow,
  type SplitSide,
  SplitSides,
} from "@web/components/DiffRows/types";
import {
  EXPANDED_RIGHT_NUMBER_SELECTOR,
  EXPANDED_ROW_SELECTOR,
} from "@web/components/DiffRows/consts";
import type { DragSelection, RailView, UnderRowLayout } from "./types";
import { NO_SELECTION } from "./consts";
import { isContextKind } from "@web/utils/diffTokens/utils";
import { type ExpandableEdge, ExpansionDirections } from "../../../types";
import {
  type DigestThreadRow,
  demotedSubmittedCommentIds,
} from "@web/features/conversation/utils";
import type { SiblingSpan } from "../../../utils/siblingSpans";

/** The other side of each paired row, so one rail can speak for both. */
export function buildPairPartners(
  pairs: SplitRow[],
): ReadonlyMap<number, number> {
  const partners = new Map<number, number>();

  for (const pair of pairs) {
    if (pair.left === undefined || pair.right === undefined) continue;
    if (pair.left === pair.right) continue;
    partners.set(pair.left.index, pair.right.index);
    partners.set(pair.right.index, pair.left.index);
  }

  return partners;
}

/**
 * One rail for a pair: the run of whichever side has one, and a cap wherever
 * either side starts or ends that same run, so a run that begins on a
 * deletion paired with an addition still gets its jump target.
 */
export function unionRail(
  own: DiffRowView | undefined,
  other: DiffRowView | undefined,
): RailView {
  const run = own?.revRun ?? other?.revRun;
  if (run === undefined) return { run, isStart: false, isEnd: false };

  const ownIn = own?.revRun === run;
  const otherIn = other?.revRun === run;
  const isStart = (ownIn && own.isRevStart) || (otherIn && other.isRevStart);
  const isEnd = (ownIn && own.isRevEnd) || (otherIn && other.isRevEnd);

  return { run, isStart, isEnd };
}

export function spanForPlacement(
  placement: SplitSide | undefined,
  layout: UnderRowLayout,
): number {
  const sideColumns = layout.sideColumns ?? 0;
  if (placement === SplitSides.RIGHT) return sideColumns;
  return layout.columnCount - sideColumns;
}

export function placementForAnchor(
  anchor: CommentAnchor,
): SplitSide | undefined {
  if (!isLineCommentAnchor(anchor)) return undefined;
  if (anchor.startSide !== undefined && anchor.startSide !== anchor.side) {
    return undefined;
  }
  return anchor.side === CommentSides.OLD ? SplitSides.LEFT : SplitSides.RIGHT;
}

export function sideForRow(line: DiffLine): SplitSide {
  return line.kind === DiffLineKinds.DEL ? SplitSides.LEFT : SplitSides.RIGHT;
}

/** GitHub's side wins; a crossing thread spans the row like a crossing draft. */
export function placementForThread(
  thread: ConversationThread,
  line: DiffLine,
): SplitSide | undefined {
  if (thread.side === undefined) return sideForRow(line);
  if (thread.startSide !== undefined && thread.startSide !== thread.side) {
    return undefined;
  }
  return thread.side === ThreadSides.LEFT ? SplitSides.LEFT : SplitSides.RIGHT;
}

/** Context rows take one Tab stop, on the right; the arrow hop reaches the left. */
export function isSideFocusable(
  line: DiffLine,
  side: SplitSide | undefined,
): boolean {
  if (side === undefined) return true;
  if (isContextKind(line.kind)) return side === SplitSides.RIGHT;
  return true;
}

export function resolveDragSelection(
  pairs: SplitRow[],
  start: number | null,
  current: number | null,
  startSide: SplitSide | undefined,
  currentSide: SplitSide | undefined,
): DragSelection {
  if (start === null || current === null) return NO_SELECTION;
  if (startSide !== undefined && startSide === currentSide) {
    return {
      indexes: collectSideIndexes(pairs, startSide, start, current),
      placement: startSide,
    };
  }
  const span = rangeBetween(start, current);

  // Same rule as a same-side drag: a hunk or note row between the ends is
  // not part of any selection, so the whole range is refused rather than
  // highlighted and then rejected at the anchor.
  return spansFullWidthRow(pairs, span)
    ? NO_SELECTION
    : { indexes: span, placement: undefined };
}

export function spansFullWidthRow(pairs: SplitRow[], span: number[]): boolean {
  const full = new Set(
    pairs
      .map((pair) => pair.full?.index)
      .filter((index) => index !== undefined),
  );

  return span.some((index) => full.has(index));
}

/** The unified indexes one side shows between two of its cells, in order. */
export function collectSideIndexes(
  pairs: SplitRow[],
  side: SplitSide,
  from: number,
  to: number,
): number[] {
  const positions = pairs.map((pair) => pair[side]?.index);
  const fromAt = positions.indexOf(from);
  const toAt = positions.indexOf(to);
  if (fromAt < 0 || toAt < 0) return [];
  const [low, high] = fromAt < toAt ? [fromAt, toAt] : [toAt, fromAt];
  const indexes: number[] = [];

  for (let position = low; position <= high; position += 1) {
    if (pairs[position]?.full !== undefined) return [];
    const index = positions[position];
    if (index !== undefined) indexes.push(index);
  }

  return indexes;
}

export interface ExpandedRowViewParams {
  line: DiffLine;
  index: number;
  /** The chunk whose table renders the row. */
  hostId: string;
  /** The chunk that owns the row's line; absent leaves it uncommentable. */
  owner: string | undefined;
  /** Whether the owner's own diff carries this row, so a comment can anchor to it. */
  commentable: boolean;
  /** The owners' comments; the row shows the ones ending on its line. */
  comments: readonly ReviewComment[];
  activeCommentAnchor: CommentAnchor | null;
  dragIndexes: ReadonlySet<number>;
  /** Rendered indexes the active anchor covers inside a span. */
  activeIndexes: ReadonlySet<number>;
}

/**
 * A row spliced from outside the chunk. No marks and no revision run, those
 * belong to the chunk's own rows. Comments match by coordinates: row ids
 * belong to the owner's own table.
 */
export function buildExpandedRowView({
  line,
  index,
  hostId,
  owner,
  commentable,
  comments,
  activeCommentAnchor,
  dragIndexes,
  activeIndexes,
}: ExpandedRowViewParams): DiffRowView {
  const rowComments =
    owner === undefined
      ? []
      : comments.filter(
          (comment) =>
            isLineCommentAnchor(comment.anchor) &&
            comment.anchor.chunkId === owner &&
            anchorEndsOnRow(comment.anchor, line),
        );
  const showComposer =
    owner !== undefined &&
    activeCommentAnchor !== null &&
    isLineCommentAnchor(activeCommentAnchor) &&
    activeCommentAnchor.chunkId === owner &&
    anchorEndsOnRow(activeCommentAnchor, line);

  return {
    id: `${hostId}:expanded:${String(index)}`,
    isCommentable: owner !== undefined && commentable,
    revRun: undefined,
    revMark: undefined,
    isRevStart: false,
    isRevEnd: false,
    rowComments,
    rowAddressedComments: [],
    isSelected: dragIndexes.has(index) || activeIndexes.has(index),
    showComposer,
  };
}

/**
 * The rendered rows a line anchor covers, by coordinates. Same-side: every
 * row whose line on that side is in range. Cross-side: the rows between the
 * start and end lines in render order, headers and notes skipped.
 */
export function collectAnchoredIndexes(
  rows: readonly DiffLine[],
  anchor: LineCommentAnchor,
): number[] {
  const startSide = anchor.startSide ?? anchor.side;
  if (startSide === anchor.side) {
    const indexes: number[] = [];
    rows.forEach((row, index) => {
      const line = lineOnSide(row, anchor.side);
      if (line === undefined) return;
      if (line >= anchor.startLine && line <= anchor.endLine) {
        indexes.push(index);
      }
    });
    return indexes;
  }
  const start = rows.findIndex(
    (row) => lineOnSide(row, startSide) === anchor.startLine,
  );
  const end = rows.findLastIndex(
    (row) => lineOnSide(row, anchor.side) === anchor.endLine,
  );
  if (start === -1 || end === -1 || end < start) return [];

  return rangeBetween(start, end).filter((index) => {
    const row = rows[index];
    return row?.oldLine !== undefined || row?.newLine !== undefined;
  });
}

function lineOnSide(row: DiffLine, side: CommentSide): number | undefined {
  return side === CommentSides.OLD ? row.oldLine : row.newLine;
}

/**
 * Row ids in the owner's own table for the rows a span selection picked,
 * so the owner card matches the comment the way it matches its own. Empty
 * when the owner's diff does not carry a picked row; coordinates then match.
 */
export function collectOwnerRowIds(
  owner: BriefChunk,
  rows: readonly DiffLine[],
  indexes: readonly number[],
): string[] {
  const ownerRows = owner.diff ?? [];
  const rowIds: string[] = [];
  for (const index of indexes) {
    const line = rows[index];
    const at =
      line === undefined
        ? -1
        : ownerRows.findIndex((row) => matchesLine(row, line));
    if (at === -1) return [];
    rowIds.push(rowId(owner.id, at));
  }

  return rowIds;
}

/** The same line of the same file: kind and numbers agree. */
export function matchesLine(row: DiffLine, line: DiffLine): boolean {
  return (
    row.kind === line.kind &&
    row.oldLine === line.oldLine &&
    row.newLine === line.newLine
  );
}

/**
 * Whether a comment can anchor to an expanded row: the owner's own diff
 * carries the line, context between two of its changed lines included.
 * Without the owner's diff, kind decides: a changed line is in the diff.
 */
export function isSpanRowCommentable(
  line: DiffLine,
  owner: BriefChunk | undefined,
): boolean {
  if (owner === undefined) return false;
  if (owner.diff === undefined) return isCommentableLine(line);

  return owner.diff.some((row) => matchesLine(row, line));
}

export function groupEdgesByRow(
  edges: readonly ExpandableEdge[],
): ReadonlyMap<number, ExpandableEdge[]> {
  const byRow = new Map<number, ExpandableEdge[]>();

  for (const edge of edges) {
    const own = byRow.get(edge.rowIndex) ?? [];
    own.push(edge);
    byRow.set(edge.rowIndex, own);
  }

  return byRow;
}

/**
 * The focusable cell of the expanded row showing this head-file line. The
 * NEW-side number is the one to match, an old number can equal it.
 */
export function focusExpandedLine(
  table: HTMLTableElement | null,
  line: number,
  options: FocusOptions,
): void {
  if (table === null) return;
  const wanted = String(line);
  const unified = table.querySelectorAll(EXPANDED_ROW_SELECTOR);
  for (const row of unified) {
    const numbers = row.querySelectorAll("[data-line-number]");
    if (numbers[1]?.textContent !== wanted) continue;
    if (row instanceof HTMLElement) row.focus(options);
    return;
  }
  const cells = table.querySelectorAll(EXPANDED_RIGHT_NUMBER_SELECTOR);
  for (const cell of cells) {
    if (cell.textContent !== wanted) continue;
    const target = cell.nextElementSibling;
    if (target instanceof HTMLElement && target.matches("[tabindex]")) {
      target.focus(options);
    }
    return;
  }
}

export function collectThreadLines(rows: readonly DigestThreadRow[]): number[] {
  const lines: number[] = [];
  for (const row of rows) {
    if (row.thread.line !== undefined) lines.push(row.thread.line);
  }

  return lines;
}

/** A thread belongs to the expanded row showing its line on its side. */
export function showsThreadOnRow(
  row: DigestThreadRow,
  line: DiffLine,
): boolean {
  const threadLine = row.thread.line;
  if (threadLine === undefined) return false;
  const side = row.thread.side ?? ThreadSides.RIGHT;

  return (
    threadLine === (side === ThreadSides.LEFT ? line.oldLine : line.newLine)
  );
}

/** Where one span's header, gutter edge and end rule render. */
export interface SpanFrame {
  owner: string;
  /** The row whose before-row slot carries the header. */
  headerAt: number;
  /** The row whose under-row slot carries the end rule. */
  endAt: number;
  /** In pair order, not row order: a split pair lists left then right. */
  rows: readonly number[];
}

/** Unified rows: a frame is the span itself. */
export function frameSpans(spans: readonly SiblingSpan[]): SpanFrame[] {
  return spans.map((span) => ({
    owner: span.owner,
    headerAt: span.start,
    endAt: span.end,
    rows: rangeBetween(span.start, span.end),
  }));
}

/**
 * Split pairs: a pair zips a deletion with the addition that follows it, so
 * its two cells can belong to different spans. A frame takes only pairs
 * whose every cell sits in one span, and opens and closes once per pair.
 */
export function frameSpansOnPairs(
  spans: readonly SiblingSpan[],
  pairs: readonly SplitRow[],
): SpanFrame[] {
  const spanOfRow = new Map<number, SiblingSpan>();
  for (const span of spans) {
    for (const index of rangeBetween(span.start, span.end)) {
      spanOfRow.set(index, span);
    }
  }
  const frames: SpanFrame[] = [];
  let open: { span: SiblingSpan; frame: SpanFrame; rows: number[] } | undefined;

  for (const pair of pairs) {
    const cells = collectPairCells(pair);
    const span = resolvePairSpan(cells, spanOfRow);
    if (span === undefined) {
      open = undefined;
      continue;
    }
    const indexes = cells.map((cell) => cell.index);
    const endAt = indexes.at(-1) ?? 0;
    if (open?.span === span) {
      open.frame.endAt = endAt;
      open.rows.push(...indexes);
      continue;
    }
    const frame: SpanFrame = {
      owner: span.owner,
      headerAt: indexes[0] ?? 0,
      endAt,
      rows: indexes,
    };
    frames.push(frame);
    open = { span, frame, rows: indexes };
  }

  return frames;
}

/** A pair's cells in the order the row slots fire: left, then right. */
function collectPairCells(pair: SplitRow): SplitCell[] {
  const cells: SplitCell[] = [];
  if (pair.left !== undefined) cells.push(pair.left);
  if (pair.right !== undefined && pair.right !== pair.left) {
    cells.push(pair.right);
  }

  return cells;
}

function resolvePairSpan(
  cells: readonly SplitCell[],
  spanOfRow: ReadonlyMap<number, SiblingSpan>,
): SiblingSpan | undefined {
  const first = cells[0];
  if (first === undefined) return undefined;
  const span = spanOfRow.get(first.index);
  if (span === undefined) return undefined;
  const shared = cells.every((cell) => spanOfRow.get(cell.index) === span);

  return shared ? span : undefined;
}

/**
 * A pair zips a deletion with the addition after it because they abut, but
 * two owners' changes are not one replacement. A run of such pairs renders
 * as its left sides then its right sides, one-sided rows all, so each side
 * frames, pairs and emphasises on its own.
 */
export function unzipPairsByOwner(
  pairs: readonly SplitRow[],
  ownerOf: (index: number) => string | undefined,
): SplitRow[] {
  const rows: SplitRow[] = [];
  let straddling: SplitRow[] = [];
  const flush = () => {
    for (const pair of straddling) {
      if (pair.left !== undefined) {
        rows.push({ key: `${pair.key}:left`, left: pair.left });
      }
    }
    for (const pair of straddling) {
      if (pair.right !== undefined) {
        rows.push({ key: `${pair.key}:right`, right: pair.right });
      }
    }
    straddling = [];
  };

  for (const pair of pairs) {
    if (sharesOwner(pair, ownerOf)) {
      flush();
      rows.push(pair);
      continue;
    }
    straddling.push(pair);
  }
  flush();

  return rows;
}

function sharesOwner(
  pair: SplitRow,
  ownerOf: (index: number) => string | undefined,
): boolean {
  const { left, right } = pair;
  if (left === undefined || right === undefined || left === right) return true;

  return ownerOf(left.index) === ownerOf(right.index);
}

export interface SpanLines {
  side: LineSide;
  from: number;
  to: number;
}

/**
 * The first and last changed line a frame shows: new-side numbers where it
 * adds anything, old-side numbers for a frame that only deletes. Context
 * rows inside the frame never name it.
 */
export function resolveSpanLines(
  rows: readonly DiffLine[],
  indexes: readonly number[],
): SpanLines {
  const changed = indexes
    .map((index) => rows[index])
    .filter((row): row is DiffLine => row !== undefined)
    .filter(
      (row) => row.kind === DiffLineKinds.ADD || row.kind === DiffLineKinds.DEL,
    );
  const adds = changed.filter((row) => row.kind === DiffLineKinds.ADD);
  const side: LineSide = adds.length > 0 ? "new" : "old";
  const numbers = (adds.length > 0 ? adds : changed).map((row) =>
    side === "new" ? row.newLine : row.oldLine,
  );

  return { side, from: numbers[0] ?? 0, to: numbers.at(-1) ?? 0 };
}

/** Every row index a frame covers, for the gutter edge. */
export function collectSpannedRows(
  frames: readonly SpanFrame[],
): ReadonlySet<number> {
  const spanned = new Set<number>();
  for (const frame of frames) {
    for (const index of frame.rows) spanned.add(index);
  }

  return spanned;
}

/**
 * Base rows anchor on base indexes; a range holding an expanded row has no
 * base index and is answered by the span path instead.
 */
export function mapToBaseIndexes(
  indexes: readonly number[],
  baseIndexOf: readonly number[] | undefined,
): number[] | undefined {
  if (baseIndexOf === undefined) return [...indexes];
  const mapped = indexes.map((index) => baseIndexOf[index] ?? -1);

  return mapped.includes(-1) ? undefined : mapped;
}

/** The base rows a drag covers; expanded rows drop out. */
export function collectDragBaseIndexes(
  dragIndexes: ReadonlySet<number>,
  baseIndexOf: readonly number[] | undefined,
): Set<number> {
  if (baseIndexOf === undefined) return new Set(dragIndexes);

  return new Set(
    [...dragIndexes]
      .map((index) => baseIndexOf[index] ?? -1)
      .filter((index) => index >= 0),
  );
}

/**
 * The one sibling that owns every picked row, when all of them are
 * commentable: a range that leaves the span, or crosses into expanded
 * context, has no owner.
 */
export function resolveSpanRangeOwner(
  indexes: readonly number[],
  spanOwnerByRow: ReadonlyMap<number, string>,
  rowViews: readonly (DiffRowView | undefined)[],
  ownerChunkById: ReadonlyMap<string, BriefChunk>,
): BriefChunk | undefined {
  const ownerIds = new Set(indexes.map((index) => spanOwnerByRow.get(index)));
  if (ownerIds.size !== 1) return undefined;
  const [ownerId] = ownerIds;
  if (ownerId === undefined) return undefined;
  if (indexes.some((index) => rowViews[index]?.isCommentable !== true)) {
    return undefined;
  }

  return ownerChunkById.get(ownerId);
}

function isUpEdge(edge: ExpandableEdge): boolean {
  return edge.gap.edge.direction === ExpansionDirections.UP;
}

/** A hunk row's control carries its own edges and the up edge of the row under it. */
export function resolveHunkRowEdges(
  edgesByRow: ReadonlyMap<number, readonly ExpandableEdge[]>,
  index: number,
): ExpandableEdge[] {
  const hosted = edgesByRow.get(index) ?? [];
  const above = edgesByRow.get(index + 1) ?? [];

  return hosted.concat(above.filter(isUpEdge));
}

/**
 * The edges a row of its own hosts above a line: none for a hunk row (its
 * control is the row itself), and an up edge right under a header rides
 * the header's own row.
 */
export function resolveBeforeRowEdges(
  edgesByRow: ReadonlyMap<number, readonly ExpandableEdge[]>,
  index: number,
  row: DiffLine,
  previousRow: DiffLine | undefined,
): ExpandableEdge[] {
  const hosted = edgesByRow.get(index) ?? [];
  if (hosted.length === 0 || row.kind === DiffLineKinds.HUNK) return [];
  if (previousRow?.kind !== DiffLineKinds.HUNK) return [...hosted];

  return hosted.filter((edge) => !isUpEdge(edge));
}

/**
 * Server-backed wins: once a posted comment's own GitHub thread renders,
 * the local submitted card demotes out of display.
 */
export function demoteSubmitted(
  comments: ReviewComment[],
  ownThreads: readonly ConversationThread[],
): ReviewComment[] {
  if (ownThreads.length === 0) return comments;
  const demoted = demotedSubmittedCommentIds(comments, ownThreads);

  return demoted.size === 0
    ? comments
    : comments.filter((comment) => !demoted.has(comment.id));
}

/** A line anchor on the given rows, on one side when the pick stayed on one. */
export function buildLineAnchor(
  chunkId: string,
  file: string,
  sourceRows: DiffLine[],
  indexes: number[],
  side: SplitSide | undefined,
): LineCommentAnchor | null {
  if (side === undefined) {
    return createCommentAnchor(chunkId, file, sourceRows, indexes);
  }
  const commentSide =
    side === SplitSides.LEFT ? CommentSides.OLD : CommentSides.NEW;

  return createSideAnchor(chunkId, file, sourceRows, indexes, commentSide);
}
