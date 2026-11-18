import { DiffLineKinds, type DiffSide } from "types";
import { type DiffLine } from "@web/utils/diffTokens/types";

import { LINE_ATTRIBUTES, LINE_STOP_ATTRIBUTE } from "./consts";
import type { CodeIndentStyle } from "./types";

/** CSS's initial `tab-size`; the code cell sets none. */
const TAB_SIZE_COLUMNS = 8;

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
export function buildLineCellSelector(side: DiffSide, line: number): string {
  return `td[${LINE_ATTRIBUTES[side]}="${String(line)}"]`;
}

/**
 * The focus target showing a line: the unified row whose number cell on
 * that side matches, or in split view the code cell beside the matching
 * number cell, since a pair's row carries two lines. A split code cell is
 * a line stop and a unified number cell's neighbour never is. Only the
 * outermost table counts: a suggestion preview inside a comment renders
 * rows too.
 */
export function findRowByLine(
  root: ParentNode,
  side: DiffSide,
  line: number,
): HTMLElement | null {
  for (const cell of root.querySelectorAll(buildLineCellSelector(side, line))) {
    if (isNested(cell)) {
      continue;
    }
    const beside = cell.nextElementSibling;
    const isSplitStop =
      beside instanceof HTMLElement && beside.hasAttribute(LINE_STOP_ATTRIBUTE);
    if (isSplitStop) {
      return beside;
    }
    const row = cell.closest("tr");
    return row instanceof HTMLElement ? row : null;
  }

  return null;
}

function isNested(element: Element): boolean {
  return element.closest("table")?.parentElement?.closest("table") !== null;
}

/** The columns a line's leading whitespace spans, a tab running to the next tab stop. */
export function countIndentColumns(content: string): number {
  let columns = 0;
  for (const character of content) {
    if (character === " ") {
      columns += 1;
    } else if (character === "\t") {
      columns += TAB_SIZE_COLUMNS - (columns % TAB_SIZE_COLUMNS);
    } else {
      break;
    }
  }

  return columns;
}

/** The code cell's indent property; absent for an unindented line. */
export function buildCodeIndentStyle(
  content: string,
): CodeIndentStyle | undefined {
  const columns = countIndentColumns(content);
  if (columns === 0) {
    return undefined;
  }

  return { "--code-indent": columns };
}
