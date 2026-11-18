import { DiffLineKinds } from "types/diff-lines";
import type { LineRange } from "../../../types";
import { SLICE_CONTEXT_ROWS } from "../consts";
import type { ChunkRanges, ParsedDiffLine } from "../types";

/**
 * Slice a file's parsed diff down to the rows a chunk claims: changed rows
 * inside the chunk's added/removed ranges, each with two rows of surrounding
 * diff on either side and its governing hunk header. Rows outside every
 * range are dropped; an empty result means the chunk's ranges matched nothing.
 */
export function sliceChunkDiff<Row extends ParsedDiffLine>(
  rows: readonly Row[],
  chunk: ChunkRanges,
): Row[] {
  const selected = new Set<number>();
  let hunkIndex: number | undefined;

  rows.forEach((row, index) => {
    if (row.kind === DiffLineKinds.HUNK) {
      hunkIndex = index;
      return;
    }
    if (!isClaimedRow(row, chunk)) {
      return;
    }
    if (hunkIndex !== undefined) {
      selected.add(hunkIndex);
    }
    selectSurroundingRows(rows, index, selected);
  });

  return rows.filter((_row, index) => selected.has(index));
}

function isClaimedRow(row: ParsedDiffLine, chunk: ChunkRanges): boolean {
  if (row.kind === DiffLineKinds.ADD) {
    return isLineInRanges(row.newLine, chunk.addedRanges);
  }
  if (row.kind === DiffLineKinds.DEL) {
    return isLineInRanges(row.oldLine, chunk.removedRanges);
  }

  return false;
}

function selectSurroundingRows(
  rows: readonly ParsedDiffLine[],
  index: number,
  selected: Set<number>,
): void {
  const first = Math.max(0, index - SLICE_CONTEXT_ROWS);
  const last = Math.min(rows.length - 1, index + SLICE_CONTEXT_ROWS);

  for (let position = first; position <= last; position += 1) {
    if (rows[position]?.kind !== DiffLineKinds.HUNK) {
      selected.add(position);
    }
  }
}

function isLineInRanges(
  line: number | undefined,
  ranges: readonly LineRange[],
): boolean {
  const inRange =
    typeof line === "number" &&
    ranges.some((range) => line >= range.start && line <= range.end);
  return inRange;
}
