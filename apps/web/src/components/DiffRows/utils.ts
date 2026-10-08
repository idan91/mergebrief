import {
  DiffLineKinds,
  type DiffLine,
  type HunkSideName,
} from "@web/utils/diffTokens/types";

import { LINE_ATTRIBUTES } from "./consts";

/** Hunk and note rows span every column and take no slot content. */
export function isFullWidthDiffRow(row: DiffLine): boolean {
  return row.kind === DiffLineKinds.HUNK || row.kind === DiffLineKinds.NOTE;
}

/** A diff pairs only with both sides to pair: additions-only or deletions-only reads unified. */
export function hasPairedSides(rows: readonly DiffLine[]): boolean {
  const hasAdd = rows.some((row) => row.kind === DiffLineKinds.ADD);
  const hasDel = rows.some((row) => row.kind === DiffLineKinds.DEL);

  return hasAdd && hasDel;
}

/**
 * A row's identity across re-renders. Line numbers, not the index: expansion
 * splices rows above, and an index key would remount every row below the
 * splice, dropping focus and any scroll anchor with it.
 */
export function buildDiffRowKey(row: DiffLine, index: number): string {
  if (row.kind === DiffLineKinds.HUNK) {
    return `hunk-${row.content}`;
  }
  if (row.kind === DiffLineKinds.NOTE) {
    return `note-${String(index)}`;
  }
  const oldLine = row.oldLine === undefined ? "" : String(row.oldLine);
  const newLine = row.newLine === undefined ? "" : String(row.newLine);

  return `${row.kind}-${oldLine}-${newLine}`;
}

/**
 * A key per row, unique within the diff: a synthetic or malformed diff can
 * repeat a line number, and a repeat takes an occurrence suffix that stays
 * put across a splice, since expanded rows never repeat a changed line.
 */
export function buildDiffRowKeys(rows: readonly DiffLine[]): string[] {
  const seen = new Map<string, number>();

  return rows.map((row, index) => {
    const key = buildDiffRowKey(row, index);
    const count = seen.get(key) ?? 0;
    seen.set(key, count + 1);

    return count === 0 ? key : `${key}#${String(count)}`;
  });
}

/** The number cell showing a line on a side. */
export function buildLineCellSelector(
  side: HunkSideName,
  line: number,
): string {
  return `td[${LINE_ATTRIBUTES[side]}="${String(line)}"]`;
}

/**
 * The focus target showing a line: the unified row whose number cell on
 * that side matches, or in split view the code cell beside the matching
 * number cell, since a pair's row carries two lines. Only the outermost
 * table counts: a suggestion preview inside a comment renders rows too.
 */
export function findRowByLine(
  root: ParentNode,
  side: HunkSideName,
  line: number,
): HTMLElement | null {
  for (const cell of root.querySelectorAll(buildLineCellSelector(side, line))) {
    if (isNested(cell)) {
      continue;
    }
    if (cell.hasAttribute("data-side")) {
      const target = cell.nextElementSibling;
      return target instanceof HTMLElement ? target : null;
    }
    const row = cell.closest("tr");
    return row instanceof HTMLElement ? row : null;
  }

  return null;
}

function isNested(element: Element): boolean {
  return element.closest("table")?.parentElement?.closest("table") !== null;
}
