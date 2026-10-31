// Shared height model for chunk cards: the CSS paint-skip estimate and the
// window virtualizer must agree on what a not-yet-rendered card is worth, or
// scroll targets drift as real heights reveal.
// DIFF_ROW_HEIGHT_PX is in lockstep with the row line-height in
// `DiffRows.module.scss` and with `DiffTable.module.scss`'s
// `contain-intrinsic-block-size` estimate: change all three or none. It is
// one line; a wrapped row is a multiple, so the estimate is a lower bound
// that `measureElement` and the painted size correct after first paint.
import {
  LINE_WIDTH_BUCKET_EDGES,
  type ChunkLayoutCounts,
  type LineWidthHistogram,
} from "brief-core/chunk-layout";
import { DiffViews, type DiffView } from "@web/components/DiffRows/types";

export const DIFF_ROW_HEIGHT_PX = 22;

/** What a hunk header or an expand lane adds over a code row (a 31px lane). */
export const TALL_ROW_EXTRA_PX = 9;

/**
 * Columns a code cell fits before a line wraps, a fixed middle of the
 * widths readers use: measured 147 at 1920px and about 105 at 1440px for
 * the unified cell (7.8px a glyph), a split half just under half of that.
 * Fixed because the server and the client must reserve the same height.
 */
export const UNIFIED_CODE_COLUMNS = 125;
export const SPLIT_CODE_COLUMNS = 58;

/** Card chrome around the diff table: head row, chips, paddings, card gap. */
export const CHUNK_CARD_OVERHEAD_PX = 96;

/** A collapsed card renders its head only. */
export const COLLAPSED_CARD_HEIGHT_PX = 56;

/** The large-diff notice under a closed large card's head. */
export const LARGE_CHUNK_NOTICE_PX = 52;

export interface ChunkCardSizeInput {
  /** Rendered diff rows (`chunk.diff.length`), 0 for a missing diff. */
  diffRowCount: number;
  open: boolean;
  /** Past the large-diff limit: a closed card shows the notice. */
  large?: boolean;
}

/** The "diff unavailable" note a diff-less open card renders instead of rows. */
export const EMPTY_DIFF_NOTE_PX = 40;

export function estimateChunkCardHeight(input: ChunkCardSizeInput): number {
  if (!input.open) {
    return input.large === true
      ? COLLAPSED_CARD_HEIGHT_PX + LARGE_CHUNK_NOTICE_PX
      : COLLAPSED_CARD_HEIGHT_PX;
  }
  if (input.diffRowCount === 0) {
    return CHUNK_CARD_OVERHEAD_PX + EMPTY_DIFF_NOTE_PX;
  }
  return input.diffRowCount * DIFF_ROW_HEIGHT_PX + CHUNK_CARD_OVERHEAD_PX;
}

export interface ReservedChunkSizeInput {
  counts: ChunkLayoutCounts;
  view: DiffView;
  open: boolean;
  large?: boolean | undefined;
}

/**
 * A card's height from its stored counts, before any code reaches the page:
 * the rows the view paints, the controls drawn as rows of their own, the
 * extra height of each tall row, and the lines long code wraps into.
 */
export function estimateReservedChunkCardHeight(
  input: ReservedChunkSizeInput,
): number {
  const { counts, view, open, large } = input;
  if (!open) {
    const collapsed: ChunkCardSizeInput = { diffRowCount: 0, open };
    if (large !== undefined) {
      collapsed.large = large;
    }
    return estimateChunkCardHeight(collapsed);
  }

  return estimateReservedRowsHeight(counts, view) + CHUNK_CARD_OVERHEAD_PX;
}

/**
 * The height the rows alone reserve: what the skeleton occupies, so a
 * measured placeholder equals its estimate and no window compensates for
 * the difference.
 */
export function estimateReservedRowsHeight(
  counts: ChunkLayoutCounts,
  view: DiffView,
): number {
  if (counts.rows === 0) {
    return EMPTY_DIFF_NOTE_PX;
  }
  const codeRows = view === DiffViews.SPLIT ? counts.splitRows : counts.rows;
  const tallRows = counts.hunkRows + counts.expandRows;
  const columns =
    view === DiffViews.SPLIT ? SPLIT_CODE_COLUMNS : UNIFIED_CODE_COLUMNS;
  const rows =
    codeRows +
    counts.expandRows +
    countWrappedLines(counts.lineWidths, columns);

  return rows * DIFF_ROW_HEIGHT_PX + tallRows * TALL_ROW_EXTRA_PX;
}

/** Extra lines the histogram's rows take past `columns`; a bucket wraps at its midpoint. */
export function countWrappedLines(
  histogram: LineWidthHistogram,
  columns: number,
): number {
  let extra = 0;
  let lowerEdge = 0;

  LINE_WIDTH_BUCKET_EDGES.forEach((edge, index) => {
    const rows = histogram.counts[index] ?? 0;
    const midpoint = (lowerEdge + edge) / 2;
    extra += rows * (Math.ceil(midpoint / columns) - 1);
    lowerEdge = edge;
  });

  const overflowRows = histogram.counts[LINE_WIDTH_BUCKET_EDGES.length] ?? 0;
  if (overflowRows > 0) {
    const meanWidth = histogram.overflowColumns / overflowRows;
    extra += overflowRows * (Math.ceil(meanWidth / columns) - 1);
  }

  return Math.max(extra, 0);
}

/** Narrative card chrome: the head with its action, summary paragraph, margins. */
export const NARRATIVE_CARD_OVERHEAD_PX = 145;

/** The removed-lines note under a card's rows. */
export const REMOVED_NOTE_PX = 24;

export interface NarrativeCardSizeInput {
  /** Rows the card's guest table renders, removed lines included. */
  rowCount: number;
  hasRemovedNote: boolean;
}

export function estimateNarrativeCardHeight(
  input: NarrativeCardSizeInput,
): number {
  return (
    input.rowCount * DIFF_ROW_HEIGHT_PX +
    NARRATIVE_CARD_OVERHEAD_PX +
    (input.hasRemovedNote ? REMOVED_NOTE_PX : 0)
  );
}
