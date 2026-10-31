import { DiffLineKinds, type DiffLineKind } from "types/diff-lines";
import { LINE_WIDTH_BUCKET_EDGES, TAB_STOP_COLUMNS } from "../consts";
import type { LineWidthHistogram, ParsedDiffLine } from "../types";

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
  let cursor = 0;

  while (cursor < rows.length) {
    const row = rows[cursor];
    if (row === undefined) {
      break;
    }
    if (row.kind !== DiffLineKinds.DEL && row.kind !== DiffLineKinds.ADD) {
      if (row.kind === DiffLineKinds.CTX) {
        addWidth(histogram, measureDisplayWidth(row.content));
      }
      cursor += 1;
      continue;
    }

    const dels = takeRun(rows, cursor, DiffLineKinds.DEL);
    const adds = takeRun(rows, cursor + dels.length, DiffLineKinds.ADD);
    const pairs = Math.max(dels.length, adds.length);
    for (let pair = 0; pair < pairs; pair += 1) {
      const left = measureDisplayWidth(dels[pair]?.content ?? "");
      const right = measureDisplayWidth(adds[pair]?.content ?? "");
      addWidth(histogram, Math.max(left, right));
    }
    cursor += dels.length + adds.length;
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

function takeRun(
  rows: readonly ParsedDiffLine[],
  from: number,
  kind: DiffLineKind,
): ParsedDiffLine[] {
  const run: ParsedDiffLine[] = [];
  let row = rows[from];
  while (row?.kind === kind) {
    run.push(row);
    row = rows[from + run.length];
  }

  return run;
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
