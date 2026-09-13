import {
  HunkSideNames,
  type HunkSide,
  type RowTokenLine,
  type RowTokenMap,
} from "./types";

/**
 * `tokensBySide[i]` holds the tokenized lines of `sides[i]` in `text` order.
 * The old side is read first whatever order the caller passes, so a context
 * row present on both always ends up carrying the new side's tokens. A line
 * whose tokens do not spell the row's own text is dropped, so a misaligned
 * side never paints another row's code.
 */
export function mapTokensToRows(
  sides: HunkSide[],
  tokensBySide: RowTokenLine[][],
): RowTokenMap {
  const byRow: RowTokenMap = new Map();

  for (const sideIndex of rankOldSideFirst(sides)) {
    const side = sides[sideIndex];
    const lines = tokensBySide[sideIndex];
    if (side === undefined) continue;
    if (lines === undefined) continue;

    side.rowIndexes.forEach((rowIndex, lineIndex) => {
      const line = lines[lineIndex];
      const text = side.text[lineIndex];
      if (line !== undefined && spellsText(line, text))
        byRow.set(rowIndex, line);
    });
  }

  return byRow;
}

/** Old sides first, so a new side written later wins a shared context row. */
function rankOldSideFirst(sides: readonly HunkSide[]): number[] {
  const indexes = sides.map((_side, index) => index);

  return indexes.toSorted(
    (left, right) => rankSide(sides, left) - rankSide(sides, right),
  );
}

function rankSide(sides: readonly HunkSide[], index: number): number {
  return sides[index]?.side === HunkSideNames.OLD ? 0 : 1;
}

function spellsText(line: RowTokenLine, text: string | undefined): boolean {
  if (text === undefined) return false;

  let joined = "";
  for (const token of line) joined += token.text;

  return joined === text;
}
