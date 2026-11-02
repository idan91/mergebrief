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
 * True when one side of a between-heads run meets the PR change on that
 * side: its `count` lines from `start`, or, with none, the point before
 * line `start`. A point at the edge of an added block is beside it, not in it.
 */
function touchesPrChange(
  start: number,
  count: number,
  places: PrChangePlaces,
): boolean {
  if (count === 0) {
    const insideAddedBlock = places.addedLines.some(
      (window) => window.start < start && start <= window.end,
    );
    return insideAddedBlock || places.deletionAnchors.includes(start);
  }
  const end = start + count - 1;
  const overlapsAdded = places.addedLines.some(
    (window) => window.start <= end && window.end >= start,
  );
  if (overlapsAdded) {
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
