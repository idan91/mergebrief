import { DiffLineKinds, type DiffLine } from "@web/utils/diffTokens/types";

/** Hunk and note rows span every column and take no slot content. */
export function isFullWidthDiffRow(row: DiffLine): boolean {
  return row.kind === DiffLineKinds.HUNK || row.kind === DiffLineKinds.NOTE;
}
