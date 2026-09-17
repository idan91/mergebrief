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
import {
  type ExpandableEdge,
  ExpansionDirections,
  type LineRange,
} from "../../../types";
import { isClaimedLine } from "../../../utils/expansionState";
import type { DigestThreadRow } from "@web/features/conversation/utils";

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

/** A hidden thread belongs to the expanded row showing its line, unless a sibling chunk claimed that line first. */
export function showsHiddenThread(
  row: DigestThreadRow,
  line: DiffLine,
  claimed: readonly LineRange[],
): boolean {
  const threadLine = row.thread.line;
  if (threadLine === undefined || threadLine !== line.newLine) return false;

  return !isClaimedLine(threadLine, claimed);
}
