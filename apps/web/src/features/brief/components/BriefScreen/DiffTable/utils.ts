import { rangeBetween } from "@web/utils/collections";
import {
  type ConversationThread,
  ThreadSides,
} from "@web/features/conversation/types";
import {
  type CommentAnchor,
  CommentSides,
  isLineCommentAnchor,
} from "@web/features/review/utils";
import type { DiffRowView } from "./diffRowView";
import { type DiffLine, DiffLineKinds } from "@web/utils/diffTokens/types";
import {
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
import type { DigestThreadRow } from "@web/features/conversation/utils";
import type { SiblingSpan } from "../../../utils/siblingSpans";
import type { LineSide } from "../../../utils/lineOwner";

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

/** A row from the file at head: focusable, never commentable, nothing on it. */
export function buildExpandedRowView(
  chunkId: string,
  index: number,
): DiffRowView {
  return {
    id: `${chunkId}:expanded:${String(index)}`,
    isCommentable: false,
    revRun: undefined,
    revMark: undefined,
    isRevStart: false,
    isRevEnd: false,
    rowComments: [],
    rowAddressedComments: [],
    isSelected: false,
    showComposer: false,
  };
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

export function isUpEdge(edge: ExpandableEdge): boolean {
  return edge.gap.edge.direction === ExpansionDirections.UP;
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

/** A hidden thread belongs to the expanded row showing its line. */
export function showsHiddenThread(
  row: DigestThreadRow,
  line: DiffLine,
): boolean {
  const threadLine = row.thread.line;

  return threadLine !== undefined && threadLine === line.newLine;
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
