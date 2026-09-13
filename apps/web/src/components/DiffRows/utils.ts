import { DiffLineKinds, type DiffLine } from "@web/utils/diffTokens/types";

/** Hunk and note rows span every column and take no slot content. */
export function isFullWidthDiffRow(row: DiffLine): boolean {
  return row.kind === DiffLineKinds.HUNK || row.kind === DiffLineKinds.NOTE;
}

/** A diff pairs only with a line on each side; one side alone reads unified. */
export function hasPairedSides(rows: readonly DiffLine[]): boolean {
  const deletes = rows.some((row) => row.kind === DiffLineKinds.DEL);
  const adds = rows.some((row) => row.kind === DiffLineKinds.ADD);
  return deletes && adds;
}
