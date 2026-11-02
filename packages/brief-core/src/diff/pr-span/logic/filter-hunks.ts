import type { ChangeRun } from "../types";
import { readChangeRuns, splitPatchHunks } from "./change-runs";

interface LineWindow {
  readonly start: number;
  readonly end: number;
}

/** Where one head's PR change sits in that head's lines: its added lines and the points its deletions sit before. */
export interface PrChangePlaces {
  readonly addedLines: readonly LineWindow[];
  readonly deletionAnchors: readonly number[];
}

export const NO_PR_CHANGE: PrChangePlaces = {
  addedLines: [],
  deletionAnchors: [],
};

export function readPrChangePlaces(runs: readonly ChangeRun[]): PrChangePlaces {
  const addedLines: LineWindow[] = [];
  const deletionAnchors: number[] = [];
  for (const run of runs) {
    if (run.added > 0) {
      addedLines.push({
        start: run.newStart,
        end: run.newStart + run.added - 1,
      });
    }
    if (run.removed > 0) {
      deletionAnchors.push(run.newStart);
    }
  }
  return { addedLines, deletionAnchors };
}

/**
 * True when one side of a between-heads run meets or abuts the PR change on
 * that side: its `count` lines from `start`, or, with none, the point before
 * line `start`. Abutting counts because a run moved no further than its own
 * length shows as the base lines beside it moving, not the run.
 */
function touchesPrChange(
  start: number,
  count: number,
  places: PrChangePlaces,
): boolean {
  const end = start + count - 1;
  const meetsAdded = places.addedLines.some(
    (window) => window.start <= end + 1 && window.end + 1 >= start,
  );
  if (meetsAdded) {
    return true;
  }
  return places.deletionAnchors.some(
    (anchor) => start <= anchor && anchor <= end + 1,
  );
}

function isPrRun(
  run: ChangeRun,
  prev: PrChangePlaces,
  next: PrChangePlaces,
): boolean {
  return (
    touchesPrChange(run.oldStart, run.removed, prev) ||
    touchesPrChange(run.newStart, run.added, next)
  );
}

/**
 * The between-heads patch cut to the hunks that touch either head's PR
 * change: a run whose previous-head lines meet the previous PR change, or
 * whose new-head lines meet the new one. Nothing when no hunk does.
 */
export function filterBetweenHeadsHunks(
  patch: string,
  prev: PrChangePlaces,
  next: PrChangePlaces,
): string | undefined {
  const keptHunks = new Set<number>();
  for (const run of readChangeRuns(patch)) {
    if (isPrRun(run, prev, next)) {
      keptHunks.add(run.hunk);
    }
  }
  if (keptHunks.size === 0) {
    return undefined;
  }

  const { header, hunks } = splitPatchHunks(patch);
  const kept = hunks.filter((_hunk, index) => keptHunks.has(index));
  return [...header, ...kept.flat()].join("\n");
}
