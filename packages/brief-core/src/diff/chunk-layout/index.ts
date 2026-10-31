import { DiffLineKinds } from "types/diff-lines";
import { resolveFileStatus } from "./logic/file-status";
import { findExpansionGaps } from "./logic/gaps";
import { measureLineWidths } from "./logic/line-widths";
import { parseUnifiedDiffPatch, splitUnifiedDiffByFile } from "./logic/parse";
import { sliceChunkDiff } from "./logic/slice";
import { countSplitRows } from "./logic/split-rows";
import {
  ExpansionDirections,
  type BriefLayoutSource,
  type ChunkLayoutBody,
  type ChunkLayoutCounts,
  type ChunkRanges,
  type ExpansionGap,
  type ParsedDiffLine,
} from "./types";

export { HUNK_HEADER } from "./consts";
export { resolveFileStatus } from "./logic/file-status";
export { findExpansionGaps } from "./logic/gaps";
export { parseUnifiedDiffPatch, splitUnifiedDiffByFile } from "./logic/parse";
export { sliceChunkDiff } from "./logic/slice";
export { countSplitRows } from "./logic/split-rows";
export { LINE_WIDTH_BUCKET_EDGES, SLICE_CONTEXT_ROWS } from "./consts";
export {
  ExpansionDirections,
  FileStatuses,
  type BriefLayoutSource,
  type ChunkLayoutBody,
  type ChunkLayoutCounts,
  type ChunkRanges,
  type ExpansionDirection,
  type ExpansionEdge,
  type ExpansionGap,
  type FileStatus,
  type LineWidthHistogram,
  type ParsedDiffLine,
} from "./types";

/**
 * What a chunk's card draws before any reader expands it, from its file's
 * parsed diff: the same slice and the same expand controls the review page
 * renders. A file the diff creates or deletes offers no expand control.
 */
export function countChunkLayout(
  fileRows: readonly ParsedDiffLine[],
  chunk: ChunkRanges,
): ChunkLayoutCounts {
  const slice = sliceChunkDiff(fileRows, chunk);
  const hunkRows = slice.filter((row) => row.kind === DiffLineKinds.HUNK);
  const wholeFile = resolveFileStatus(slice) !== undefined;

  return {
    rows: slice.length,
    hunkRows: hunkRows.length,
    expandRows: wholeFile
      ? 0
      : countExpandRows(slice, findExpansionGaps(slice)),
    splitRows: countSplitRows(slice),
    lineWidths: measureLineWidths(slice),
  };
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
  const chunks: Record<string, ChunkLayoutCounts> = {};
  const files: Record<string, ChunkLayoutCounts> = {};

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
function countExpandRows(
  slice: readonly ParsedDiffLine[],
  gaps: readonly ExpansionGap[],
): number {
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

  return ownRows.size;
}
