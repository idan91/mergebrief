import { SLICE_CONTEXT_ROWS, type ChunkRanges } from "brief-core/chunk-layout";
import { MIN_LINE_DIGITS } from "./consts";

/** One shine cycle, the sweep plus the pause: tracks `--shine-cycle` in the stylesheet. */
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

/** Digits the slice's widest line number takes, the context past its last claimed line included. */
export function countLineDigits(ranges: ChunkRanges): number {
  let lastLine = 0;
  for (const range of [...ranges.addedRanges, ...ranges.removedRanges]) {
    lastLine = Math.max(lastLine, range.end);
  }
  const sliceEnd = lastLine + SLICE_CONTEXT_ROWS;

  return Math.max(String(sliceEnd).length, MIN_LINE_DIGITS);
}
