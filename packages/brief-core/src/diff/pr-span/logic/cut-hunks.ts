import { cutHunkLines, readHunkLines, type HunkLine } from "./cut-lines";

/** Each line's kept flag: a change line takes its run's flag, a run being a block of change lines no context line splits. */
function readLineFlags(
  items: readonly HunkLine[],
  isKeptRun: readonly boolean[],
): boolean[] {
  let runIndex = -1;
  return items.map((item, index) => {
    if (!item.isChange) {
      return false;
    }
    if (items[index - 1]?.isChange !== true) {
      runIndex += 1;
    }
    return isKeptRun[runIndex] === true;
  });
}

/**
 * One hunk cut down to its kept runs, `isKeptRun` naming each run in order:
 * each with up to three context lines either side, the context stopping at
 * any dropped run, windows that meet joined into one hunk, every header
 * recounted from the original hunk's line numbers. Nothing when no run is kept.
 */
export function cutHunk(
  hunk: readonly string[],
  isKeptRun: readonly boolean[],
): string[] {
  const items = readHunkLines(hunk);
  return cutHunkLines(items, readLineFlags(items, isKeptRun));
}
