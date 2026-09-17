import { useCallback, useMemo } from "react";

import { rangeBetween } from "@web/utils/collections";
import { computeIntraLineEmphasis } from "@web/components/DiffRows/diffPairedTokens";
import { pairSplitRows } from "@web/components/DiffRows/pairSplitRows";
import { hasPairedSides } from "@web/components/DiffRows/utils";
import { type DiffView, DiffViews } from "@web/components/DiffRows/types";
import type { DiffLine, RowTokenMap } from "@web/utils/diffTokens/types";
import type { BriefChunk } from "../../../types";
import type { FileLineOwners } from "../../../utils/lineOwner";
import { resolveSpanOwner } from "../../../utils/lineOwner";
import { groupSiblingSpans } from "../../../utils/siblingSpans";
import { NO_PAIRS, NO_SPANS } from "./consts";
import {
  buildPairPartners,
  collectSpannedRows,
  frameSpans,
  frameSpansOnPairs,
  isSpanRowCommentable,
  unzipPairsByOwner,
} from "./utils";

export interface DiffTableModelInput {
  rows: DiffLine[];
  chunk: BriefChunk;
  lineOwners: FileLineOwners | undefined;
  hasExpandedRows: boolean;
  diffView: DiffView;
  tokensByRow: RowTokenMap | undefined;
}

/**
 * The row model the table renders from: which rows a sibling owns, how
 * rows pair in split view, where each span's frame sits, and the emphasis
 * the pairs carry. Every value is memoized on the rows it reads.
 */
export function useDiffTableModel({
  rows,
  chunk,
  lineOwners,
  hasExpandedRows,
  diffView,
  tokensByRow,
}: DiffTableModelInput) {
  // A line the chunk's own ranges hold is never a sibling's, whatever the
  // owner index says about it.
  const spans = useMemo(
    () =>
      lineOwners === undefined || !hasExpandedRows
        ? NO_SPANS
        : groupSiblingSpans(rows, (line) => {
            const owner = resolveSpanOwner(lineOwners, line)?.chunkId;
            return owner === chunk.id ? undefined : owner;
          }),
    [rows, lineOwners, hasExpandedRows, chunk.id],
  );
  const spanOwnerByRow = useMemo(() => {
    const byRow = new Map<number, string>();
    for (const span of spans) {
      for (const index of rangeBetween(span.start, span.end)) {
        byRow.set(index, span.owner);
      }
    }
    return byRow;
  }, [spans]);
  const canPairSides = useMemo(() => hasPairedSides(rows), [rows]);
  const split = diffView === DiffViews.SPLIT && canPairSides;
  const resolvedView = split ? DiffViews.SPLIT : DiffViews.UNIFIED;

  const pairRows = useCallback(
    () =>
      unzipPairsByOwner(pairSplitRows(rows), (index) =>
        spanOwnerByRow.get(index),
      ),
    [rows, spanOwnerByRow],
  );
  const pairs = useMemo(
    () => (split ? pairRows() : NO_PAIRS),
    [split, pairRows],
  );
  const spanFrames = useMemo(
    () => (split ? frameSpansOnPairs(spans, pairs) : frameSpans(spans)),
    [spans, split, pairs],
  );
  const spanStarts = useMemo(
    () => new Map(spanFrames.map((frame) => [frame.headerAt, frame])),
    [spanFrames],
  );
  const spanEnds = useMemo(
    () => new Set(spanFrames.map((frame) => frame.endAt)),
    [spanFrames],
  );
  const spannedRows = useMemo(
    () => collectSpannedRows(spanFrames),
    [spanFrames],
  );
  const spanOwnerIds = useMemo(
    () => [...new Set(spans.map((span) => span.owner))].toSorted(),
    [spans],
  );
  const ownerChunkById = useMemo(
    () => new Map(lineOwners?.chunks.map((owner) => [owner.id, owner])),
    [lineOwners],
  );
  // Once per row set, not per render: a drag re-renders the table on every
  // row the pointer crosses, and the owner's diff scan is per span row.
  const commentableSpanRows = useMemo(() => {
    const commentable = new Set<number>();
    for (const [index, owner] of spanOwnerByRow) {
      const line = rows[index];
      if (line === undefined) continue;
      if (isSpanRowCommentable(line, ownerChunkById.get(owner))) {
        commentable.add(index);
      }
    }
    return commentable;
  }, [rows, spanOwnerByRow, ownerChunkById]);
  const pairPartners = useMemo(() => buildPairPartners(pairs), [pairs]);
  // Unified pairs the same rows for emphasis without rendering them paired.
  const emphasisByRow = useMemo(
    () => computeIntraLineEmphasis(split ? pairs : pairRows(), tokensByRow),
    [pairs, pairRows, split, tokensByRow],
  );

  return {
    spans,
    spanOwnerByRow,
    split,
    resolvedView,
    pairs,
    spanFrames,
    spanStarts,
    spanEnds,
    spannedRows,
    spanOwnerIds,
    ownerChunkById,
    commentableSpanRows,
    pairPartners,
    emphasisByRow,
  };
}
