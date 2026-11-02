import type { HunkSpan } from "../../remap";
import { IDENTITY_SPAN, REST_OF_FILE_LINES } from "../consts";
import type { ChangeRun, PrFilePatch } from "../types";
import { hasSameRuns } from "./change-runs";

interface StretchBounds {
  /** First line of the stretch at the previous head, and the line past it. */
  readonly prevFrom: number;
  readonly prevTo: number;
  readonly newFrom: number;
  readonly newTo: number;
}

/** A stretch of non-run lines as a span; a side with no lines names the line before, as git does. */
function makeStretchSpan(bounds: StretchBounds): HunkSpan | undefined {
  const oldLines = bounds.prevTo - bounds.prevFrom;
  const newLines = bounds.newTo - bounds.newFrom;
  if (oldLines === 0 && newLines === 0) {
    return undefined;
  }
  return {
    oldStart: oldLines === 0 ? bounds.prevFrom - 1 : bounds.prevFrom,
    oldLines,
    newStart: newLines === 0 ? bounds.newFrom - 1 : bounds.newFrom,
    newLines,
  };
}

/**
 * The hop of a file whose PR change is the same at both heads while the
 * base moved under it. Each run pairs with its twin; every stretch between
 * runs becomes a span, so a range on a run shifts by exactly that run's
 * offset and a range in a stretch demotes. Nothing when the runs cannot pair.
 */
export function buildBaseMovedSpans(
  prevRuns: readonly ChangeRun[],
  nextRuns: readonly ChangeRun[],
): HunkSpan[] | undefined {
  if (prevRuns.length !== nextRuns.length) {
    return undefined;
  }

  const spans: HunkSpan[] = [];
  let prevCursor = 1;
  let newCursor = 1;
  for (const [index, prevRun] of prevRuns.entries()) {
    const nextRun = nextRuns[index];
    const isOutOfOrder =
      nextRun === undefined ||
      prevRun.newStart < prevCursor ||
      nextRun.newStart < newCursor;
    if (isOutOfOrder) {
      return undefined;
    }
    const span = makeStretchSpan({
      prevFrom: prevCursor,
      prevTo: prevRun.newStart,
      newFrom: newCursor,
      newTo: nextRun.newStart,
    });
    if (span !== undefined) {
      spans.push(span);
    }
    prevCursor = prevRun.newStart + prevRun.added;
    newCursor = nextRun.newStart + nextRun.added;
  }

  spans.push({
    oldStart: prevCursor,
    oldLines: REST_OF_FILE_LINES,
    newStart: newCursor,
    newLines: REST_OF_FILE_LINES,
  });
  return spans;
}

/** A run read from its removed side, so a stretch walk moves base-side lines. */
function readRemovedSide(run: ChangeRun): ChangeRun {
  return { ...run, newStart: run.oldStart, added: run.removed };
}

/**
 * The old-side hop of a file whose PR change is the same at both heads:
 * identity where the base under it held still, else each run's removed
 * lines shift with their twin's. Nothing when the runs cannot pair.
 */
export function buildOldSideSpans(
  prev: PrFilePatch,
  next: PrFilePatch,
): HunkSpan[] | undefined {
  const isSameBase =
    prev.preBlobId !== undefined && prev.preBlobId === next.preBlobId;
  if (isSameBase) {
    return [IDENTITY_SPAN];
  }
  if (!hasSameRuns(prev.runs, next.runs)) {
    return undefined;
  }
  return buildBaseMovedSpans(
    prev.runs.map(readRemovedSide),
    next.runs.map(readRemovedSide),
  );
}

/** One run's lines as a span; a side with no lines names the line before, as git does. */
function makeRunSpan(run: ChangeRun): HunkSpan {
  return {
    oldStart: run.removed === 0 ? run.oldStart - 1 : run.oldStart,
    oldLines: run.removed,
    newStart: run.added === 0 ? run.newStart - 1 : run.newStart,
    newLines: run.added,
  };
}

/**
 * The hop of a file read through a line diff, one span per change run with
 * no context, so a range beside an edit still places. Identity when the
 * diff holds no run.
 */
export function buildLineDiffSpans(runs: readonly ChangeRun[]): HunkSpan[] {
  if (runs.length === 0) {
    return [IDENTITY_SPAN];
  }
  return runs.map(makeRunSpan);
}
