import { isContextKind } from "./utils";
import {
  DiffLineKinds,
  HunkSideNames,
  type TokenizableRow,
  type HunkSide,
  type HunkSideName,
} from "./types";

/**
 * Rebuilds the two continuous texts a hunk was cut from, so a grammar sees
 * whole statements instead of interleaved add and del rows. A chunk slice
 * keeps only the rows around its own changes, so one hunk can arrive with
 * file lines missing between two rows and no header row marking the seam;
 * a line-number jump on either side starts a fresh pair, or an opener left
 * unclosed before the gap would swallow the code after it.
 */
export function reconstructHunkSides(rows: TokenizableRow[]): HunkSide[] {
  const sides: HunkSide[] = [];
  let oldSide = startSide(HunkSideNames.OLD);
  let newSide = startSide(HunkSideNames.NEW);
  let lastOldLine: number | undefined;
  let lastNewLine: number | undefined;

  function flush(): void {
    if (oldSide.text.length > 0) {
      sides.push(oldSide);
    }
    if (newSide.text.length > 0) {
      sides.push(newSide);
    }
    oldSide = startSide(HunkSideNames.OLD);
    newSide = startSide(HunkSideNames.NEW);
    lastOldLine = undefined;
    lastNewLine = undefined;
  }

  rows.forEach((row, index) => {
    if (row.kind === DiffLineKinds.HUNK || row.kind === DiffLineKinds.NOTE) {
      flush();
      return;
    }

    const readsOld = row.kind === DiffLineKinds.DEL || isContextKind(row.kind);
    const readsNew = row.kind === DiffLineKinds.ADD || isContextKind(row.kind);
    const skipsOld = readsOld && skipsLines(lastOldLine, row.oldLine);
    const skipsNew = readsNew && skipsLines(lastNewLine, row.newLine);
    if (skipsOld || skipsNew) {
      flush();
    }

    if (readsOld) {
      oldSide.text.push(row.content);
      oldSide.rowIndexes.push(index);
      if (oldSide.startLine === undefined && row.oldLine !== undefined) {
        oldSide.startLine = row.oldLine;
      }
      if (row.oldLine !== undefined) {
        lastOldLine = row.oldLine;
      }
    }

    if (readsNew) {
      newSide.text.push(row.content);
      newSide.rowIndexes.push(index);
      if (newSide.startLine === undefined && row.newLine !== undefined) {
        newSide.startLine = row.newLine;
      }
      if (row.newLine !== undefined) {
        lastNewLine = row.newLine;
      }
    }
  });

  flush();

  return sides;
}

function skipsLines(
  lastLine: number | undefined,
  line: number | undefined,
): boolean {
  if (lastLine === undefined || line === undefined) {
    return false;
  }

  return line !== lastLine + 1;
}

function startSide(side: HunkSideName): HunkSide {
  return { side, text: [], rowIndexes: [] };
}
