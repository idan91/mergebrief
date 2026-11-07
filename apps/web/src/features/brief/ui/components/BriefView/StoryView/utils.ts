import {
  countSplitRows,
  type ChunkLayoutCounts,
} from "brief-core/chunk-layout";
import { DiffViews, type DiffView } from "@web/components/DiffRows/types";
import type { DiffLine } from "@web/utils/diffTokens/types";
import type { BriefChunk } from "../../../../model/types";
import {
  readStoredCounts,
  type StoredChunkCounts,
} from "../../../../model/chunk-layout/useChunkLayout";
import {
  countExpandedRows,
  hasExpandedEdge,
} from "../../../../model/expansion/edges";
import type { EdgeExpansion } from "../../../../model/expansion/types";
import type { FileRowsCache } from "../../../../model/file-rows/cache";
import {
  DIFF_ROW_HEIGHT_PX,
  estimateChunkCardHeight,
  estimateReservedChunkCardHeight,
  type ChunkCardMetrics,
  type WrapColumns,
} from "../reading/chunk-height-model";
import { resolveChunkView } from "../utils";

export interface StoryChunkRowCounts {
  /** Rows the card's own view paints, expanded rows included. */
  diff: number;
  expanded: number;
}

export interface StoryChunkRowsInput {
  chunks: readonly BriefChunk[];
  diffView: DiffView;
  expandedEdges: ReadonlyMap<string, EdgeExpansion>;
  fileRows: FileRowsCache | undefined;
  storedCounts: StoredChunkCounts | undefined;
}

export const NO_STORY_ROWS: StoryChunkRowCounts = { diff: 0, expanded: 0 };
const NO_DIFF: DiffLine[] = [];

/**
 * Each card's painted rows, expanded ones charged at the same row height. A
 * card's rows are sliced on first read, so one sized from stored counts with
 * no expanded edge is never read here: reading it would slice every card in
 * the group at once.
 */
export function countStoryChunkRows(
  input: StoryChunkRowsInput,
): StoryChunkRowCounts[] {
  const { diffView, expandedEdges, fileRows, storedCounts } = input;
  return input.chunks.map((chunk) => {
    const stored = readStoredCounts(storedCounts, chunk);
    const sizedFromStore =
      stored !== undefined && !hasExpandedEdge(expandedEdges, chunk.id);
    if (sizedFromStore) {
      return NO_STORY_ROWS;
    }

    const withRows = fileRows?.attachChunkRows(chunk) ?? chunk;
    const base = withRows.diff ?? NO_DIFF;
    const chunkView = resolveChunkView(diffView, chunk, false);
    const expanded = countExpandedRows(
      expandedEdges,
      chunk.id,
      base,
      fileRows?.getFileRows(chunk.file),
      chunkView,
    );
    const diffRows = countDiffRows(base, chunkView) + expanded;
    return { diff: diffRows, expanded };
  });
}

export interface StoryChunkHeightInput {
  chunk: Pick<BriefChunk, "addedRanges" | "removedRanges">;
  /** The group's view; the card draws its own resolved from it. */
  groupView: DiffView;
  counts: ChunkLayoutCounts | undefined;
  rows: StoryChunkRowCounts;
  open: boolean;
  large: boolean;
  metrics: ChunkCardMetrics;
  wrapColumns: WrapColumns;
}

export function countDiffRows(
  diff: readonly DiffLine[],
  view: DiffView,
): number {
  return view === DiffViews.SPLIT ? countSplitRows(diff) : diff.length;
}

/**
 * A story card's height before it measures, in the view its skeleton and
 * table draw: a one-sided card in a split group draws unified.
 */
export function estimateStoryChunkHeight(input: StoryChunkHeightInput): number {
  const { counts, rows, open, large, metrics, wrapColumns } = input;
  if (counts === undefined) {
    return estimateChunkCardHeight({
      diffRowCount: rows.diff,
      open,
      large,
      metrics,
    });
  }

  const view = resolveChunkView(input.groupView, input.chunk, false);
  const reserved = estimateReservedChunkCardHeight({
    counts,
    view,
    open,
    large,
    metrics,
    wrapColumns,
  });
  if (!open) {
    return reserved;
  }
  return reserved + rows.expanded * DIFF_ROW_HEIGHT_PX;
}
