import type { ChangeRun, HeadTexts } from "../types";
import { readChangeRuns, splitPatchHunks } from "./change-runs";
import { cutHunk } from "./cut-hunks";
import { splitTextLines } from "./utils";

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

const NO_SLIDE: SlideRange = { up: 0, down: 0 };

/** Each head's lines, 1-based by index + 1, for the runs that may slide. */
interface HeadLines {
  readonly prev: readonly string[];
  readonly next: readonly string[];
}

function readHeadLines(texts: HeadTexts | undefined): HeadLines | undefined {
  if (texts === undefined) {
    return undefined;
  }
  return {
    prev: splitTextLines(texts.prevContent),
    next: splitTextLines(texts.newContent),
  };
}

/** How far a block of lines can move up, and down, over equal lines. */
interface SlideRange {
  readonly up: number;
  readonly down: number;
}

/** How far a block of `count` lines from line `start` can move up, and down, over equal lines. */
function readSlideRange(
  lines: readonly string[],
  start: number,
  count: number,
): SlideRange {
  let up = 0;
  while (
    start - up > 1 &&
    lines[start - up - 2] === lines[start + count - up - 2]
  ) {
    up += 1;
  }
  let down = 0;
  while (
    start + count + down <= lines.length &&
    lines[start + count + down - 1] === lines[start + down - 1]
  ) {
    down += 1;
  }
  return { up, down };
}

/**
 * True when either side of the run, moved anywhere from `up` lines up to
 * `down` lines down, meets the PR change on that side. The places one side
 * covers over the whole slide form one range, so each side is tested once.
 */
function touchesAcrossSlide(
  run: ChangeRun,
  slide: SlideRange,
  prev: PrChangePlaces,
  next: PrChangePlaces,
): boolean {
  const reach = slide.up + slide.down;
  return (
    touchesPrChange(run.oldStart - slide.up, run.removed + reach, prev) ||
    touchesPrChange(run.newStart - slide.up, run.added + reach, next)
  );
}

/**
 * A pure insertion or deletion between equal lines reads the same at every
 * place in its slide range, so it touches when any place does: the line
 * diff may have put it a few lines from where the PR patch did.
 */
function touchesAnywhereInSlide(
  run: ChangeRun,
  prev: PrChangePlaces,
  next: PrChangePlaces,
  lines: HeadLines,
): boolean {
  const isInsertion = run.removed === 0;
  const isDeletion = run.added === 0;
  if (isInsertion === isDeletion) {
    return false;
  }
  const slide = isInsertion
    ? readSlideRange(lines.next, run.newStart, run.added)
    : readSlideRange(lines.prev, run.oldStart, run.removed);
  return touchesAcrossSlide(run, slide, prev, next);
}

function isPrRun(
  run: ChangeRun,
  prev: PrChangePlaces,
  next: PrChangePlaces,
  lines: HeadLines | undefined,
): boolean {
  if (touchesAcrossSlide(run, NO_SLIDE, prev, next)) {
    return true;
  }
  return lines !== undefined && touchesAnywhereInSlide(run, prev, next, lines);
}

/**
 * The between-heads patch cut to the runs that touch either head's PR
 * change: a run whose previous-head lines meet the previous PR change, or
 * whose new-head lines meet the new one, each with its context up to any
 * dropped run. With both heads' texts, a run that can slide is tested at
 * every place it could sit. Nothing when no run does.
 */
export function filterBetweenHeadsHunks(
  patch: string,
  prev: PrChangePlaces,
  next: PrChangePlaces,
  texts?: HeadTexts,
): string | undefined {
  const lines = readHeadLines(texts);
  const keptByHunk: boolean[][] = [];
  let isAnyKept = false;
  for (const run of readChangeRuns(patch)) {
    const isKept = isPrRun(run, prev, next, lines);
    isAnyKept ||= isKept;
    keptByHunk[run.hunk] ??= [];
    keptByHunk[run.hunk]?.push(isKept);
  }
  if (!isAnyKept) {
    return undefined;
  }

  const { header, hunks } = splitPatchHunks(patch);
  const cut = hunks.flatMap((hunk, index) =>
    cutHunk(hunk, keptByHunk[index] ?? []),
  );
  return [...header, ...cut].join("\n");
}
