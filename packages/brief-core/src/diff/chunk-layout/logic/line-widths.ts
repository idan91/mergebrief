import { DiffLineKinds } from "types/diff-lines";
import { LINE_WIDTH_BUCKET_EDGES, TAB_STOP_COLUMNS } from "../consts";
import type { LineWidthHistogram, ParsedDiffLine } from "../types";
import { zipSplitRows } from "./split-rows";

/** The display width of every code row, bucketed for a wrap estimate. */
export function measureLineWidths(
  rows: readonly ParsedDiffLine[],
): LineWidthHistogram {
  const histogram = makeEmptyHistogram();

  for (const row of rows) {
    if (isCodeRow(row)) {
      addWidth(histogram, measureDisplayWidth(row.content));
    }
  }

  return histogram;
}

/**
 * The display width of every row the split view paints, bucketed: a
 * deletion run and the additions after it zip row for row, and a paired
 * row wraps as its wider side does.
 */
export function measureSplitLineWidths(
  rows: readonly ParsedDiffLine[],
): LineWidthHistogram {
  const histogram = makeEmptyHistogram();

  for (const row of zipSplitRows(rows)) {
    if (row.full !== undefined) {
      if (row.full.kind === DiffLineKinds.CTX) {
        addWidth(histogram, measureDisplayWidth(row.full.content));
      }
      continue;
    }
    const left = measureDisplayWidth(row.del?.content ?? "");
    const right = measureDisplayWidth(row.add?.content ?? "");
    addWidth(histogram, Math.max(left, right));
  }

  return histogram;
}

function makeEmptyHistogram(): LineWidthHistogram {
  return {
    counts: Array.from({ length: LINE_WIDTH_BUCKET_EDGES.length + 1 }, () => 0),
    overflowColumns: 0,
  };
}

function addWidth(histogram: LineWidthHistogram, width: number): void {
  const bucket = findBucket(width);
  histogram.counts[bucket] = (histogram.counts[bucket] ?? 0) + 1;
  if (bucket === LINE_WIDTH_BUCKET_EDGES.length) {
    histogram.overflowColumns += width;
  }
}

function isCodeRow(row: ParsedDiffLine): boolean {
  return (
    row.kind === DiffLineKinds.ADD ||
    row.kind === DiffLineKinds.DEL ||
    row.kind === DiffLineKinds.CTX
  );
}

function measureDisplayWidth(content: string): number {
  let columns = 0;

  for (const character of content) {
    if (character === "\t") {
      columns += TAB_STOP_COLUMNS - (columns % TAB_STOP_COLUMNS);
      continue;
    }
    columns += 1;
  }

  return columns;
}

function findBucket(width: number): number {
  const bucket = LINE_WIDTH_BUCKET_EDGES.findIndex((edge) => width < edge);

  return bucket === -1 ? LINE_WIDTH_BUCKET_EDGES.length : bucket;
}
