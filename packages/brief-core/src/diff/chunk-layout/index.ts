import { DiffLineKinds } from "types/diff-lines";
import { resolveFileStatus } from "./logic/file-status";
import { findExpansionGaps } from "./logic/gaps";
import { measureLineWidths, measureSplitLineWidths } from "./logic/line-widths";
import { encodeRowRuns } from "./logic/row-runs";
import { parseUnifiedDiffPatch, splitUnifiedDiffByFile } from "./logic/parse";
import { sliceChunkDiff } from "./logic/slice";
import { countSplitRows } from "./logic/split-rows";
import {
  ExpansionDirections,
  type BriefLayoutSource,
  type ChunkLayoutBody,
  type ChunkRanges,
  type ExpansionGap,
  type LineWidthHistogram,
  type ParsedDiffLine,
  type StoredChunkLayoutCounts,
} from "./types";

export { HUNK_HEADER } from "./consts";
export { resolveFileStatus } from "./logic/file-status";
export { findExpansionGaps } from "./logic/gaps";
export { parsePatchPaths, readGitPath } from "./logic/header-paths";
export { parseUnifiedDiffPatch, splitUnifiedDiffByFile } from "./logic/parse";
export { readRowRuns } from "./logic/row-runs";
export { sliceChunkDiff } from "./logic/slice";
export { countSplitRows } from "./logic/split-rows";
export {
  CHUNK_ROW_RUNS,
  LINE_WIDTH_BUCKET_EDGES,
  POST_SIDE_PREFIX,
  PRE_SIDE_PREFIX,
  SLICE_CONTEXT_ROWS,
} from "./consts";
export {
  ExpansionDirections,
  FileStatuses,
  RowRunKinds,
  type BriefLayoutSource,
  type ChunkLayoutBody,
  type ChunkLayoutCounts,
  type ChunkRanges,
  type ExpansionDirection,
  type ExpansionEdge,
  type ExpansionGap,
  type FileStatus,
  type LineWidthHistogram,
  type RowRun,
  type ParsedDiffLine,
  type StoredChunkLayoutCounts,
} from "./types";

/**
 * What a chunk's card draws before any reader expands it, from its file's
 * parsed diff: the same slice and the same expand controls the review page
 * renders. A file the diff creates or deletes offers no expand control.
 */
export function countChunkLayout(
  fileRows: readonly ParsedDiffLine[],
  chunk: ChunkRanges,
): StoredChunkLayoutCounts {
  const slice = sliceChunkDiff(fileRows, chunk);
  const hunkRows = slice.filter((row) => row.kind === DiffLineKinds.HUNK);
  const wholeFile = resolveFileStatus(slice) !== undefined;
  const expandIndexes = wholeFile
    ? new Set<number>()
    : findExpandRowIndexes(slice, findExpansionGaps(slice));

  const counts: StoredChunkLayoutCounts = {
    rows: slice.length,
    hunkRows: hunkRows.length,
    expandRows: expandIndexes.size,
    splitRows: countSplitRows(slice),
    lineWidths: measureLineWidths(slice),
    rowRuns: encodeRowRuns(slice, expandIndexes),
  };
  const splitLineWidths = measureSplitLineWidths(slice);
  if (!isSameHistogram(splitLineWidths, counts.lineWidths)) {
    counts.splitLineWidths = splitLineWidths;
  }

  return counts;
}

/**
 * Every card's counts against the PR's unified diff, each file parsed once:
 * a chunk by its id, an unattributed file by its path. A card whose file the
 * diff does not carry gets no entry.
 */
export function countBriefChunkLayouts(
  diff: string,
  source: BriefLayoutSource,
): ChunkLayoutBody {
  const patches = splitUnifiedDiffByFile(diff);
  const parsedFiles = new Map<string, readonly ParsedDiffLine[]>();
  const chunks: Record<string, StoredChunkLayoutCounts> = {};
  const files: Record<string, StoredChunkLayoutCounts> = {};

  for (const chunk of source.chunks) {
    const fileRows = readFileRows(chunk.file, patches, parsedFiles);
    if (fileRows !== undefined) {
      chunks[chunk.id] = countChunkLayout(fileRows, chunk);
    }
  }
  for (const remainder of source.unattributed) {
    const fileRows = readFileRows(remainder.file, patches, parsedFiles);
    if (fileRows !== undefined) {
      files[remainder.file] = countChunkLayout(fileRows, remainder);
    }
  }

  return { chunks, files };
}

function isSameHistogram(
  first: LineWidthHistogram,
  second: LineWidthHistogram,
): boolean {
  const sameCounts = first.counts.every(
    (rows, bucket) => rows === second.counts[bucket],
  );
  return sameCounts && first.overflowColumns === second.overflowColumns;
}

function readFileRows(
  file: string,
  patches: ReadonlyMap<string, string>,
  parsedFiles: Map<string, readonly ParsedDiffLine[]>,
): readonly ParsedDiffLine[] | undefined {
  const known = parsedFiles.get(file);
  if (known !== undefined) {
    return known;
  }
  const patch = patches.get(file);
  if (patch === undefined) {
    return undefined;
  }

  const rows = parseUnifiedDiffPatch(patch);
  parsedFiles.set(file, rows);
  return rows;
}

/**
 * Edges on a hunk header ride the header's row, and so does an upward edge
 * right under one; every other row index holding an edge draws a row of its
 * own above that index, the end of the rows included.
 */
function findExpandRowIndexes(
  slice: readonly ParsedDiffLine[],
  gaps: readonly ExpansionGap[],
): ReadonlySet<number> {
  const ownRows = new Set<number>();

  for (const gap of gaps) {
    const index = gap.edge.rowIndex;
    if (slice[index]?.kind === DiffLineKinds.HUNK) {
      continue;
    }
    const ridesHeader =
      slice[index - 1]?.kind === DiffLineKinds.HUNK &&
      gap.edge.direction === ExpansionDirections.UP;
    if (!ridesHeader) {
      ownRows.add(index);
    }
  }

  return ownRows;
}
