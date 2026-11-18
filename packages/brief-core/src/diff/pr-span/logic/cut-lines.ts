import { HUNK_HEADER } from "../../chunk-layout/consts";
import { LINE_DIFF_CONTEXT_LINES, NO_NEWLINE_MARKER } from "../consts";
import { readSideStart } from "./change-runs";

/**
 * One line of a hunk body, a no-newline marker after it included. A removed
 * line's `newAt` is the new-side line it sits before.
 */
export interface HunkLine {
  readonly isChange: boolean;
  readonly lines: string[];
  readonly oldAt: number;
  readonly newAt: number;
  readonly oldCount: number;
  readonly newCount: number;
}

function makeHunkLine(line: string, oldAt: number, newAt: number): HunkLine {
  const isAdded = line.startsWith("+");
  const isRemoved = line.startsWith("-");
  return {
    isChange: isAdded || isRemoved,
    lines: [line],
    oldAt,
    newAt,
    oldCount: isAdded ? 0 : 1,
    newCount: isRemoved ? 0 : 1,
  };
}

/** A hunk's body line by line; an empty line advances neither side, as `readChangeRuns` reads it. */
export function readHunkLines(hunk: readonly string[]): HunkLine[] {
  const sides = HUNK_HEADER.exec(hunk[0] ?? "")?.groups ?? {};
  let oldLine = readSideStart(sides["oldStart"], sides["oldCount"]);
  let newLine = readSideStart(sides["newStart"], sides["newCount"]);

  const items: HunkLine[] = [];
  for (const line of hunk.slice(1)) {
    if (line === "") {
      continue;
    }
    if (line.startsWith(NO_NEWLINE_MARKER)) {
      items.at(-1)?.lines.push(line);
      continue;
    }
    const item = makeHunkLine(line, oldLine, newLine);
    items.push(item);
    oldLine += item.oldCount;
    newLine += item.newCount;
  }
  return items;
}

/** Up to the context-line count of context lines from `index` in `step`'s direction, stopping at any change line. */
function addContextReach(
  items: readonly HunkLine[],
  index: number,
  step: number,
  shown: Set<number>,
): void {
  for (let reach = 1; reach <= LINE_DIFF_CONTEXT_LINES; reach += 1) {
    const at = index + step * reach;
    if (items[at]?.isChange !== false) {
      return;
    }
    shown.add(at);
  }
}

/** A side with no lines writes git's start, the line before. */
function formatSide(at: number, count: number): string {
  const start = count === 0 ? at - 1 : at;
  return `${start},${count}`;
}

function formatCutHunk(items: readonly HunkLine[]): string[] {
  const first = items[0];
  if (first === undefined) {
    return [];
  }
  const oldCount = items.reduce((sum, item) => sum + item.oldCount, 0);
  const newCount = items.reduce((sum, item) => sum + item.newCount, 0);
  const oldSide = formatSide(first.oldAt, oldCount);
  const newSide = formatSide(first.newAt, newCount);
  return [
    `@@ -${oldSide} +${newSide} @@`,
    ...items.flatMap((item) => item.lines),
  ];
}

/**
 * A hunk's lines cut down to the kept change lines, `isKept` naming each
 * line by index: each kept line with up to three context lines either side,
 * the context stopping at any dropped change line, windows that meet joined
 * into one hunk, every header recounted from the original line numbers.
 * Nothing when no change line is kept.
 */
export function cutHunkLines(
  items: readonly HunkLine[],
  isKept: readonly boolean[],
): string[] {
  const shown = new Set<number>();
  for (const [index, item] of items.entries()) {
    if (item.isChange && isKept[index] === true) {
      shown.add(index);
      addContextReach(items, index, -1, shown);
      addContextReach(items, index, 1, shown);
    }
  }

  const cut: string[] = [];
  let window: HunkLine[] = [];
  for (const [index, item] of items.entries()) {
    if (shown.has(index)) {
      window.push(item);
      continue;
    }
    cut.push(...formatCutHunk(window));
    window = [];
  }
  cut.push(...formatCutHunk(window));
  return cut;
}
