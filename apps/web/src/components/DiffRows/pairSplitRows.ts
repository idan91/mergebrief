import { DiffLineKinds, type DiffLine } from "@web/utils/diffTokens/types";
import { isContextKind } from "@web/utils/diffTokens/utils";
import { buildDiffRowKeys, isFullWidthDiffRow } from "./utils";
import type { SplitCell, SplitRow } from "./types";

/**
 * Pairs a unified diff positionally per hunk: a run of deletions and the
 * additions that follow it zip row for row, the longer side leaving fillers.
 * Every cell keeps its unified index so anchors still resolve.
 */
export function pairSplitRows(diff: readonly DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = [];
  const keys = buildDiffRowKeys(diff);
  let cursor = 0;

  while (cursor < diff.length) {
    const line = diff[cursor];
    if (line === undefined) {
      break;
    }
    const key = keys[cursor] ?? String(cursor);

    if (isFullWidthDiffRow(line)) {
      rows.push({ key, full: { line, index: cursor } });
      cursor += 1;
      continue;
    }

    if (isContextKind(line.kind)) {
      const cell = { line, index: cursor };
      rows.push({ key, left: cell, right: cell });
      cursor += 1;
      continue;
    }

    const dels = takeRun(diff, cursor, DiffLineKinds.DEL);
    cursor += dels.length;
    const adds = takeRun(diff, cursor, DiffLineKinds.ADD);
    cursor += adds.length;
    // A kind this pairing does not know would take neither run and leave the
    // cursor where it was, so the loop would never end. `countSplitRows`
    // already steps past one; this keeps the two in step.
    if (dels.length === 0 && adds.length === 0) {
      cursor += 1;
      continue;
    }
    rows.push(...zipSides(dels, adds, keys));
  }

  return rows;
}

/**
 * How many rows the split view paints for a diff, counted without building
 * them: the height model asks this for every unmeasured card on each pass.
 */
export function countSplitRows(diff: readonly DiffLine[]): number {
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
  diff: readonly DiffLine[],
  from: number,
  kind: DiffLine["kind"],
): number {
  let length = 0;
  while (diff[from + length]?.kind === kind) {
    length += 1;
  }

  return length;
}

function takeRun(
  diff: readonly DiffLine[],
  from: number,
  kind: DiffLine["kind"],
): SplitCell[] {
  const run: SplitCell[] = [];

  for (let index = from; index < diff.length; index += 1) {
    const line = diff[index];
    if (line === undefined || line.kind !== kind) {
      break;
    }
    run.push({ line, index });
  }

  return run;
}

function zipSides(
  dels: SplitCell[],
  adds: SplitCell[],
  keys: readonly string[],
): SplitRow[] {
  const length = Math.max(dels.length, adds.length);
  const rows: SplitRow[] = [];

  for (let position = 0; position < length; position += 1) {
    const left = dels[position];
    const right = adds[position];
    const leftKey = left === undefined ? "x" : (keys[left.index] ?? "x");
    const rightKey = right === undefined ? "x" : (keys[right.index] ?? "x");
    const row: SplitRow = { key: `${leftKey}|${rightKey}` };
    if (left !== undefined) {
      row.left = left;
    }
    if (right !== undefined) {
      row.right = right;
    }
    rows.push(row);
  }

  return rows;
}
