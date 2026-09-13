import {
  HunkSideNames,
  type HunkSide,
  type RowTokenLine,
  type RowTokenMap,
} from "./types";

/**
 * `tokensBySide[i]` holds the tokenized lines of `sides[i]` in `text` order.
 * The old side is read first whatever order the caller passes, so a context
 * row present on both always ends up carrying the new side's tokens.
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
      if (line !== undefined) byRow.set(rowIndex, line);
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
