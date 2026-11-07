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
import {
  ViewportShapes,
  type ViewportShape,
} from "@web/hooks/useViewportShape/types";
import { SPLIT_MIN_WIDTH_PX } from "../StoryView/useSplitWidth";

export const DIFF_ROW_HEIGHT_PX = 22;

/** What a hunk header or an expand lane adds over a code row (a 31px lane). */
export const TALL_ROW_EXTRA_PX = 9;

/**
 * Columns a code cell fits before a line wraps, a fixed middle of the
 * widths readers use: measured 147 at 1920px and about 105 at 1440px for
 * the unified cell (7.8px a glyph), and 70 and 48 for a split half.
 * Fixed so the server and the hydrating client reserve the same height.
 */
export const UNIFIED_CODE_COLUMNS = 125;
export const SPLIT_CODE_COLUMNS = 58;

/** The columns each view's code cell wraps at. */
export interface WrapColumns {
  unified: number;
  split: number;
}

export const DESKTOP_WRAP_COLUMNS: WrapColumns = {
  unified: UNIFIED_CODE_COLUMNS,
  split: SPLIT_CODE_COLUMNS,
};

/** A glyph of the diff's 13px IBM Plex Mono: 0.6em. */
export const CODE_GLYPH_PX = 7.8;

/** The root font size the stylesheets' rem lengths are written against. */
export const DEFAULT_REM_PX = 16;

export const NARROW_MAIN_GUTTER_PX = 12;
export const MAIN_GUTTER_PX = 48;
export const NARROW_CARD_EDGE_PX = 4;
export const CARD_BORDERS_PX = 2;

/** A phone code cell's padding: the 16px sign hangs in an 18px start, then 8px at the end. */
export const PHONE_CODE_PADDING_PX = 26;

/** A phone unified row's 14px rail and 34px number column. */
export const PHONE_UNIFIED_NUMBERS_PX = 48;

/** The split table's two 14px rails and two 42px number columns: its fixed layout reads the cols, not the phone cell width. */
export const SPLIT_NUMBERS_PX = 112;

/** The page as the phone layout lays it out. */
export interface PhoneLayout {
  /** The page's width inside any scrollbar. */
  widthPx: number;
  /** Under 760px `.main` keeps a 12px gutter and a chunk card bleeds to 4px from the screen each side; from 760px the gutter is 48px. */
  cardBleeds: boolean;
  /** The root font size, 16 when absent: the stylesheets set every phone length here in rem but the card border. */
  remPx?: number | undefined;
  /** The side safe-area insets a notched phone held sideways reports, in px; zero when absent. */
  insets?: SideInsets;
}

export interface SideInsets {
  leftPx: number;
  rightPx: number;
}

/** The chunk list between `.main`'s paddings and how far a card bleeds past it on each side. */
export interface PhoneCardBox {
  listPx: number;
  bleedPx: number;
}

const NO_INSETS: SideInsets = { leftPx: 0, rightPx: 0 };

function countCodeColumns(widthPx: number, glyphPx: number): number {
  return Math.max(Math.floor(widthPx / glyphPx), 1);
}

/** `.main` pads each side to the larger of its gutter and that side's inset; a card stops its bleed at the wider inset. */
export function derivePhoneCardBox(layout: PhoneLayout): PhoneCardBox {
  const { widthPx, cardBleeds, remPx = DEFAULT_REM_PX } = layout;
  const { insets = NO_INSETS } = layout;
  const remScale = remPx / DEFAULT_REM_PX;
  const baseGutterPx = cardBleeds ? NARROW_MAIN_GUTTER_PX : MAIN_GUTTER_PX;
  const gutterPx = baseGutterPx * remScale;
  const startPx = Math.max(gutterPx, insets.leftPx);
  const endPx = Math.max(gutterPx, insets.rightPx);
  const edgeFloorPx = NARROW_CARD_EDGE_PX * remScale;
  const edgePx = Math.max(edgeFloorPx, insets.leftPx, insets.rightPx);
  const bleedPx = cardBleeds ? Math.max(gutterPx - edgePx, 0) : 0;

  return { listPx: widthPx - startPx - endPx, bleedPx };
}

/**
 * The columns each view wraps at under the mobile breakpoint, from the
 * page's width. Split renders only on a chunk list `SPLIT_MIN_WIDTH_PX`
 * wide, so under that the split figure is the narrowest list's that renders it.
 */
export function derivePhoneWrapColumns(layout: PhoneLayout): WrapColumns {
  const { remPx = DEFAULT_REM_PX } = layout;
  const remScale = remPx / DEFAULT_REM_PX;
  const { listPx, bleedPx } = derivePhoneCardBox(layout);
  const cardOverListPx = 2 * bleedPx - CARD_BORDERS_PX;
  const splitListPx = Math.max(listPx, SPLIT_MIN_WIDTH_PX);
  const codePaddingPx = PHONE_CODE_PADDING_PX * remScale;
  const glyphPx = CODE_GLYPH_PX * remScale;

  const unifiedNumbersPx = PHONE_UNIFIED_NUMBERS_PX * remScale;
  const unifiedCodePx =
    listPx + cardOverListPx - unifiedNumbersPx - codePaddingPx;
  const splitHalfPx =
    (splitListPx + cardOverListPx - SPLIT_NUMBERS_PX * remScale) / 2;
  return {
    unified: countCodeColumns(unifiedCodePx, glyphPx),
    split: countCodeColumns(splitHalfPx - codePaddingPx, glyphPx),
  };
}

/** Card chrome around the diff table: head row, chips, paddings, card gap. */
export const CHUNK_CARD_OVERHEAD_PX = 96;

/** A collapsed card renders its head only. */
export const COLLAPSED_CARD_HEIGHT_PX = 56;

/** Narrative card chrome: the head with its action, summary paragraph, margins. */
export const NARRATIVE_CARD_OVERHEAD_PX = 145;

/** The phone head's 56px border box over the desktop's: a 24px row, 11px padding and a 1px border each side. */
export const PHONE_HEAD_EXTRA_PX = 8;

/** The sideways head's 44px row under the desktop's 48px. */
export const LANDSCAPE_HEAD_SHORTFALL_PX = 4;

/** The phone narrative head's counts line under the path: a 2px gap and an 11px line at 1.55, past the 24px jump row. */
export const PHONE_NARRATIVE_HEAD_EXTRA_PX = 14;

/** Card chrome on one side of the mobile breakpoint, where the head takes two lines. */
export interface ChunkCardMetrics {
  overheadPx: number;
  collapsedPx: number;
  narrativeOverheadPx: number;
}

/** The large-diff notice under a closed large card's head. */
export const LARGE_CHUNK_NOTICE_PX = 52;

export interface ChunkCardSizeInput {
  /** Rendered diff rows (`chunk.diff.length`), 0 for a missing diff. */
  diffRowCount: number;
  open: boolean;
  /** Past the large-diff limit: a closed card shows the notice. */
  large?: boolean;
  metrics: ChunkCardMetrics;
}

/** The "diff unavailable" note a diff-less open card renders instead of rows. */
export const EMPTY_DIFF_NOTE_PX = 40;

export const DESKTOP_CARD_METRICS: ChunkCardMetrics = {
  overheadPx: CHUNK_CARD_OVERHEAD_PX,
  collapsedPx: COLLAPSED_CARD_HEIGHT_PX,
  narrativeOverheadPx: NARRATIVE_CARD_OVERHEAD_PX,
};

export const PHONE_CARD_METRICS: ChunkCardMetrics = {
  overheadPx: CHUNK_CARD_OVERHEAD_PX + PHONE_HEAD_EXTRA_PX,
  collapsedPx: COLLAPSED_CARD_HEIGHT_PX + PHONE_HEAD_EXTRA_PX,
  narrativeOverheadPx:
    NARRATIVE_CARD_OVERHEAD_PX + PHONE_NARRATIVE_HEAD_EXTRA_PX,
};

/** Sideways the chunk head is one 44px line; the narrative head keeps the phone's counts line. */
export const LANDSCAPE_CARD_METRICS: ChunkCardMetrics = {
  overheadPx: CHUNK_CARD_OVERHEAD_PX - LANDSCAPE_HEAD_SHORTFALL_PX,
  collapsedPx: COLLAPSED_CARD_HEIGHT_PX - LANDSCAPE_HEAD_SHORTFALL_PX,
  narrativeOverheadPx:
    NARRATIVE_CARD_OVERHEAD_PX + PHONE_NARRATIVE_HEAD_EXTRA_PX,
};

const CARD_METRICS_BY_SHAPE: Record<ViewportShape, ChunkCardMetrics> = {
  [ViewportShapes.DESKTOP]: DESKTOP_CARD_METRICS,
  [ViewportShapes.PHONE]: PHONE_CARD_METRICS,
  [ViewportShapes.LANDSCAPE_PHONE]: LANDSCAPE_CARD_METRICS,
};

export function resolveChunkCardMetrics(
  shape: ViewportShape,
): ChunkCardMetrics {
  return CARD_METRICS_BY_SHAPE[shape];
}

export function estimateChunkCardHeight(input: ChunkCardSizeInput): number {
  const { metrics } = input;
  if (!input.open) {
    return input.large === true
      ? metrics.collapsedPx + LARGE_CHUNK_NOTICE_PX
      : metrics.collapsedPx;
  }
  if (input.diffRowCount === 0) {
    return metrics.overheadPx + EMPTY_DIFF_NOTE_PX;
  }
  return input.diffRowCount * DIFF_ROW_HEIGHT_PX + metrics.overheadPx;
}

export interface ReservedChunkSizeInput {
  counts: ChunkLayoutCounts;
  view: DiffView;
  open: boolean;
  large?: boolean | undefined;
  metrics: ChunkCardMetrics;
  wrapColumns: WrapColumns;
}

/**
 * A card's height from its stored counts, before any code reaches the page:
 * the rows the view paints, the controls drawn as rows of their own, the
 * extra height of each tall row, and the lines long code wraps into.
 */
export function estimateReservedChunkCardHeight(
  input: ReservedChunkSizeInput,
): number {
  const { counts, view, open, large, metrics, wrapColumns } = input;
  if (!open) {
    const collapsed: ChunkCardSizeInput = { diffRowCount: 0, open, metrics };
    if (large !== undefined) {
      collapsed.large = large;
    }
    return estimateChunkCardHeight(collapsed);
  }

  const cardHeight =
    estimateReservedRowsHeight(counts, view, wrapColumns) + metrics.overheadPx;
  return cardHeight;
}

/**
 * The height the rows alone reserve: what the skeleton occupies, so a
 * measured placeholder equals its estimate and no window compensates for
 * the difference.
 */
export function estimateReservedRowsHeight(
  counts: ChunkLayoutCounts,
  view: DiffView,
  wrapColumns: WrapColumns,
): number {
  if (counts.rows === 0) {
    return EMPTY_DIFF_NOTE_PX;
  }
  const tallRows = counts.hunkRows + counts.expandRows;
  const rowsHeight =
    countReservedLines(counts, view, wrapColumns) * DIFF_ROW_HEIGHT_PX +
    tallRows * TALL_ROW_EXTRA_PX;

  return rowsHeight;
}

/**
 * The lines a card's rows take in a view: the rows it paints, the expand
 * controls drawn as rows of their own, and the lines long code wraps into.
 */
export function countReservedLines(
  counts: ChunkLayoutCounts,
  view: DiffView,
  wrapColumns: WrapColumns,
): number {
  const codeRows = view === DiffViews.SPLIT ? counts.splitRows : counts.rows;
  const lines =
    codeRows +
    counts.expandRows +
    countViewWrappedLines(counts, view, wrapColumns);

  return lines;
}

/**
 * Extra lines a view's code rows wrap into. A split row is as tall as its
 * taller side, so the split view reads the rows bucketed by their wider
 * side; counts carry none where no pair makes them differ, and the
 * unified widths stand.
 */
export function countViewWrappedLines(
  counts: ChunkLayoutCounts,
  view: DiffView,
  wrapColumns: WrapColumns,
): number {
  const { histogram, columns } = resolveWrapHistogram(
    counts,
    view,
    wrapColumns,
  );

  return countWrappedLines(histogram, columns);
}

export interface WrapHistogram {
  histogram: LineWidthHistogram;
  columns: number;
}

/** The histogram a view wraps its code rows by, and the columns it wraps at. */
export function resolveWrapHistogram(
  counts: ChunkLayoutCounts,
  view: DiffView,
  wrapColumns: WrapColumns,
): WrapHistogram {
  if (view === DiffViews.SPLIT) {
    return {
      histogram: counts.splitLineWidths ?? counts.lineWidths,
      columns: wrapColumns.split,
    };
  }
  return { histogram: counts.lineWidths, columns: wrapColumns.unified };
}

/** Extra lines the histogram's rows take past `columns`. */
export function countWrappedLines(
  histogram: LineWidthHistogram,
  columns: number,
): number {
  const extra = listBucketWraps(histogram, columns).reduce(
    (total, bucket) => total + bucket.rows * bucket.extraLines,
    0,
  );

  return Math.max(extra, 0);
}

export interface BucketWrap {
  /** Rows in the bucket. */
  rows: number;
  /** Columns a row of the bucket is taken to span: its midpoint, the open bucket's mean. */
  columns: number;
  /** Lines each of its rows takes past its first. */
  extraLines: number;
}

/** Every bucket's rows and the lines each wraps into, narrowest first. */
export function listBucketWraps(
  histogram: LineWidthHistogram,
  columns: number,
): BucketWrap[] {
  const buckets: BucketWrap[] = [];
  let lowerEdge = 0;

  LINE_WIDTH_BUCKET_EDGES.forEach((edge, index) => {
    const midpoint = (lowerEdge + edge) / 2;
    buckets.push({
      rows: histogram.counts[index] ?? 0,
      columns: midpoint,
      extraLines: Math.ceil(midpoint / columns) - 1,
    });
    lowerEdge = edge;
  });

  const overflowRows = histogram.counts[LINE_WIDTH_BUCKET_EDGES.length] ?? 0;
  const meanWidth =
    overflowRows > 0 ? histogram.overflowColumns / overflowRows : 0;
  buckets.push({
    rows: overflowRows,
    columns: meanWidth,
    extraLines: Math.max(Math.ceil(meanWidth / columns) - 1, 0),
  });

  return buckets;
}

/** The removed-lines note under a card's rows. */
export const REMOVED_NOTE_PX = 24;

export interface NarrativeCardSizeInput {
  /** Rows the card's guest table renders, removed lines included. */
  rowCount: number;
  hasRemovedNote: boolean;
  metrics: ChunkCardMetrics;
}

export function estimateNarrativeCardHeight(
  input: NarrativeCardSizeInput,
): number {
  return (
    input.rowCount * DIFF_ROW_HEIGHT_PX +
    input.metrics.narrativeOverheadPx +
    (input.hasRemovedNote ? REMOVED_NOTE_PX : 0)
  );
}
