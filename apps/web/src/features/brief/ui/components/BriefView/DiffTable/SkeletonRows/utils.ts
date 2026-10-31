import type { ChunkLayoutCounts } from "brief-core/chunk-layout";
import { DiffViews, type DiffView } from "@web/components/DiffRows/types";
import {
  countWrappedLines,
  SPLIT_CODE_COLUMNS,
  UNIFIED_CODE_COLUMNS,
} from "../../reading/chunk-height-model";

/**
 * Bar widths by row, a fixed cycle so a re-render never reshuffles the
 * skeleton. The stylesheet's `$bar-widths` fill repeats the same cycle.
 */
export const BAR_WIDTHS_PERCENT = [
  62, 48, 74, 36, 58, 81, 44, 69, 27, 53, 77, 40,
];

/** Rows drawn as elements at most; a repeating fill draws the rest of the well. */
export const MAX_SKELETON_ROWS = 400;

export interface SkeletonRow {
  index: number;
  /** A hunk header or an expand lane, drawn taller than a code row. */
  tall: boolean;
  /** CSS width of the bar. */
  width: string;
}

export interface SkeletonPlan {
  rows: SkeletonRow[];
  /** The card reserves more rows than the cap draws: a fill covers the rest. */
  filled: boolean;
}

/**
 * The placeholder rows for a card, the same rows the height model reserves:
 * the rows its view paints, the expand controls drawn as rows of their own,
 * and the lines long code wraps into, with the tall ones spread evenly and
 * the first row a header whenever the slice has one.
 */
export function planSkeletonRows(
  counts: ChunkLayoutCounts,
  view: DiffView,
): SkeletonPlan {
  const split = view === DiffViews.SPLIT;
  const codeRows = split ? counts.splitRows : counts.rows;
  const wrapped = countWrappedLines(
    counts.lineWidths,
    split ? SPLIT_CODE_COLUMNS : UNIFIED_CODE_COLUMNS,
  );
  const reservedRows = codeRows + counts.expandRows + wrapped;
  const total = Math.min(reservedRows, MAX_SKELETON_ROWS);
  const tallCount = Math.min(counts.hunkRows + counts.expandRows, total);
  const tallIndexes = spreadIndexes(tallCount, total);

  const rows = Array.from({ length: total }, (_, index) => ({
    index,
    tall: tallIndexes.has(index),
    width: `${String(BAR_WIDTHS_PERCENT[index % BAR_WIDTHS_PERCENT.length])}%`,
  }));
  return { rows, filled: reservedRows > MAX_SKELETON_ROWS };
}

/** One shine cycle, the sweep plus the pause: tracks `$shine-cycle` in the stylesheet. */
export const SHINE_CYCLE_MS = 1600;

/**
 * The delay that puts a sweep starting at `startedAt` at the point of the
 * cycle a sweep started at `origin` has reached, so both move in step.
 */
export function resolveShineDelay(startedAt: number, origin: number): number {
  const sinceOrigin = startedAt - origin;
  const phase =
    ((sinceOrigin % SHINE_CYCLE_MS) + SHINE_CYCLE_MS) % SHINE_CYCLE_MS;

  return -phase;
}

/**
 * Steps a sweep that started after the first paint into the phase of the
 * ones the server rendered, which start with that paint. Runs on the sweep's
 * first frame, so the band is never seen anywhere else. Writes only: reading
 * style or animations inside a just-mounted `content-visibility: auto` block
 * pins Chrome's sweep to the main thread.
 */
export function alignShine(shine: HTMLElement, startedAt: number): void {
  const firstPaint = performance.getEntriesByName("first-contentful-paint")[0];
  const delay = resolveShineDelay(startedAt, firstPaint?.startTime ?? 0);

  shine.style.setProperty("--shine-delay", `${String(delay)}ms`);
}

function spreadIndexes(count: number, total: number): ReadonlySet<number> {
  const indexes = new Set<number>();
  for (let step = 0; step < count; step += 1) {
    indexes.add(Math.floor((step * total) / count));
  }
  return indexes;
}
