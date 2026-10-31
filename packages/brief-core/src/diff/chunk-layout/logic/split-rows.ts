import { DiffLineKinds, type DiffLineKind } from "types/diff-lines";
import type { ParsedDiffLine } from "../types";

/**
 * How many rows the split view paints for a diff, counted without building
 * them: a deletion run and the addition run after it zip row for row, every
 * other row stands alone.
 */
export function countSplitRows(diff: readonly ParsedDiffLine[]): number {
  let rows = 0;
  let cursor = 0;

  while (cursor < diff.length) {
    const line = diff[cursor];
    if (line === undefined) {
      break;
    }

    if (line.kind === DiffLineKinds.DEL || line.kind === DiffLineKinds.ADD) {
      const dels = measureRun(diff, cursor, DiffLineKinds.DEL);
      const adds = measureRun(diff, cursor + dels, DiffLineKinds.ADD);
      rows += Math.max(dels, adds);
      cursor += dels + adds;
      continue;
    }

    rows += 1;
    cursor += 1;
  }

  return rows;
}

function measureRun(
  diff: readonly ParsedDiffLine[],
  from: number,
  kind: DiffLineKind,
): number {
  let length = 0;
  while (diff[from + length]?.kind === kind) {
    length += 1;
  }

  return length;
}
