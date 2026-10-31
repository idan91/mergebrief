import { DiffLineKinds, type DiffLineKind } from "types/diff-lines";
import type { ParsedDiffLine, SplitViewRow } from "../types";

/**
 * The rows the split view paints for a diff: a deletion run and the
 * addition run after it zip row for row, every other row stands alone.
 */
export function zipSplitRows(diff: readonly ParsedDiffLine[]): SplitViewRow[] {
  const rows: SplitViewRow[] = [];
  let cursor = 0;

  while (cursor < diff.length) {
    const line = diff[cursor];
    if (line === undefined) {
      break;
    }
    if (line.kind !== DiffLineKinds.DEL && line.kind !== DiffLineKinds.ADD) {
      rows.push({ full: line });
      cursor += 1;
      continue;
    }

    const dels = takeRun(diff, cursor, DiffLineKinds.DEL);
    const adds = takeRun(diff, cursor + dels.length, DiffLineKinds.ADD);
    const pairs = Math.max(dels.length, adds.length);
    for (let pair = 0; pair < pairs; pair += 1) {
      rows.push(shapePairRow(dels[pair], adds[pair]));
    }
    cursor += dels.length + adds.length;
  }

  return rows;
}

export function countSplitRows(diff: readonly ParsedDiffLine[]): number {
  return zipSplitRows(diff).length;
}

function shapePairRow(
  del: ParsedDiffLine | undefined,
  add: ParsedDiffLine | undefined,
): SplitViewRow {
  const row: SplitViewRow = {};
  if (del !== undefined) {
    row.del = del;
  }
  if (add !== undefined) {
    row.add = add;
  }

  return row;
}

function takeRun(
  diff: readonly ParsedDiffLine[],
  from: number,
  kind: DiffLineKind,
): ParsedDiffLine[] {
  const run: ParsedDiffLine[] = [];
  let line = diff[from];
  while (line?.kind === kind) {
    run.push(line);
    line = diff[from + run.length];
  }

  return run;
}
