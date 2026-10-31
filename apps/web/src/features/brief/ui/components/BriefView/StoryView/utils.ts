import {
  countSplitRows,
  type ChunkLayoutCounts,
} from "brief-core/chunk-layout";
import { DiffViews, type DiffView } from "@web/components/DiffRows/types";
import type { DiffLine } from "@web/utils/diffTokens/types";
import type { BriefChunk } from "../../../../model/types";
import {
  DIFF_ROW_HEIGHT_PX,
  estimateChunkCardHeight,
  estimateReservedChunkCardHeight,
} from "../reading/chunk-height-model";
import { resolveChunkView } from "../utils";

export interface StoryChunkRowCounts {
  /** Rows the card's own view paints, expanded rows included. */
  diff: number;
  expanded: number;
}

export interface StoryChunkHeightInput {
  chunk: Pick<BriefChunk, "addedRanges" | "removedRanges">;
  /** The group's view; the card draws its own resolved from it. */
  groupView: DiffView;
  counts: ChunkLayoutCounts | undefined;
  rows: StoryChunkRowCounts;
  open: boolean;
  large: boolean;
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
  const { counts, rows, open, large } = input;
  if (counts === undefined) {
    return estimateChunkCardHeight({ diffRowCount: rows.diff, open, large });
  }

  const view = resolveChunkView(input.groupView, input.chunk, false);
  const reserved = estimateReservedChunkCardHeight({
    counts,
    view,
    open,
    large,
  });
  if (!open) {
    return reserved;
  }
  return reserved + rows.expanded * DIFF_ROW_HEIGHT_PX;
}
