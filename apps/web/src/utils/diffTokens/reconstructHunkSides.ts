import { isContextKind } from "./utils";
import {
  DiffLineKinds,
  HunkSideNames,
  type DiffLine,
  type HunkSide,
  type HunkSideName,
} from "./types";

/**
 * Rebuilds the two continuous texts a hunk was cut from, so a grammar sees
 * whole statements instead of interleaved add and del rows.
 */
export function reconstructHunkSides(rows: DiffLine[]): HunkSide[] {
  const sides: HunkSide[] = [];
  let oldSide = startSide(HunkSideNames.OLD);
  let newSide = startSide(HunkSideNames.NEW);

  function flush(): void {
    if (oldSide.text.length > 0) sides.push(oldSide);
    if (newSide.text.length > 0) sides.push(newSide);
    oldSide = startSide(HunkSideNames.OLD);
    newSide = startSide(HunkSideNames.NEW);
  }

  rows.forEach((row, index) => {
    if (row.kind === DiffLineKinds.HUNK || row.kind === DiffLineKinds.NOTE) {
      flush();
      return;
    }

    if (row.kind === DiffLineKinds.DEL || isContextKind(row.kind)) {
      oldSide.text.push(row.content);
      oldSide.rowIndexes.push(index);
    }

    if (row.kind === DiffLineKinds.ADD || isContextKind(row.kind)) {
      newSide.text.push(row.content);
      newSide.rowIndexes.push(index);
    }
  });

  flush();

  return sides;
}

function startSide(side: HunkSideName): HunkSide {
  return { side, text: [], rowIndexes: [] };
}
