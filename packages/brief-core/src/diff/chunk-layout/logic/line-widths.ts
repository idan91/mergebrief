import { DiffLineKinds } from "types/diff-lines";
import { LINE_WIDTH_BUCKET_EDGES, TAB_STOP_COLUMNS } from "../consts";
import type { LineWidthHistogram, ParsedDiffLine } from "../types";

/** The display width of every code row, bucketed for a wrap estimate. */
export function measureLineWidths(
  rows: readonly ParsedDiffLine[],
): LineWidthHistogram {
  const counts = Array.from(
    { length: LINE_WIDTH_BUCKET_EDGES.length + 1 },
    () => 0,
  );
  let overflowColumns = 0;

  for (const row of rows) {
    if (!isCodeRow(row)) {
      continue;
    }
    const width = measureDisplayWidth(row.content);
    const bucket = findBucket(width);
    counts[bucket] = (counts[bucket] ?? 0) + 1;
    if (bucket === LINE_WIDTH_BUCKET_EDGES.length) {
      overflowColumns += width;
    }
  }

  return { counts, overflowColumns };
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
