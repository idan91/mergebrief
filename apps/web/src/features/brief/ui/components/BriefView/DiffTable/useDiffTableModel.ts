import { useCallback, useMemo } from "react";

import { rangeBetween } from "@web/utils/collections";
import { computeIntraLineEmphasis } from "@web/components/DiffRows/diffPairedTokens";
import { pairSplitRows } from "@web/components/DiffRows/pairSplitRows";
import {
  hasPairedSides,
  isFullWidthDiffRow,
} from "@web/components/DiffRows/utils";
import { type DiffView, DiffViews } from "@web/components/DiffRows/types";
import type { DiffLine, RowTokenMap } from "@web/utils/diffTokens/types";
import type { BriefChunk } from "../../../../model/types";
import type { FileLineOwners } from "../../../../model/utils/lineOwner";
import { resolveSpanOwner } from "../../../../model/utils/lineOwner";
import { groupSiblingSpans } from "../../../../model/utils/siblingSpans";
import {
  type GuestRowResolution,
  type GuestRowsInput,
  resolveGuestRows,
} from "../../../utils/guest-rows";
import { NO_GUEST_ROWS, NO_PAIRS, NO_SPANS } from "./consts";
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
  guest: GuestRowsInput | undefined;
  hasExpandedRows: boolean;
  diffView: DiffView;
  tokensByRow: RowTokenMap | undefined;
}

function isCodeRow(line: DiffLine): boolean {
  return !isFullWidthDiffRow(line);
}

/** Row index to owner for the guest rows that take a comment. */
function collectGuestOwners(
  guestByRow: readonly (GuestRowResolution | undefined)[],
): Map<number, string> {
  const byRow = new Map<number, string>();
  guestByRow.forEach((resolution, index) => {
    if (resolution?.commentable === true) {
      byRow.set(index, resolution.chunkId);
    }
  });

  return byRow;
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
  guest,
  hasExpandedRows,
  diffView,
  tokensByRow,
}: DiffTableModelInput) {
  const isGuest = guest !== undefined;
  const guestByRow = useMemo(
    () =>
      guest === undefined
        ? NO_GUEST_ROWS
        : resolveGuestRows(rows, guest, isCodeRow),
    [rows, guest],
  );
  // A line the chunk's own ranges hold is never a sibling's, whatever the
  // owner index says about it. A guest table frames nothing: its card
  // already names the group.
  const spans = useMemo(
    () =>
      isGuest || lineOwners === undefined || !hasExpandedRows
        ? NO_SPANS
        : groupSiblingSpans(rows, (line) => {
            const owner = resolveSpanOwner(lineOwners, line)?.chunkId;
            return owner === chunk.id ? undefined : owner;
          }),
    [rows, lineOwners, hasExpandedRows, chunk.id, isGuest],
  );
  const spanOwnerByRow = useMemo(() => {
    if (isGuest) {
      return collectGuestOwners(guestByRow);
    }
    const byRow = new Map<number, string>();
    for (const span of spans) {
      for (const index of rangeBetween(span.start, span.end)) {
        byRow.set(index, span.owner);
      }
    }
    return byRow;
  }, [spans, isGuest, guestByRow]);
  const canPairSides = useMemo(() => hasPairedSides(rows), [rows]);
  // A guest table renders unified whatever the reader picked: its left side
  // is a baseline no comment can land on, so a split would pair inert rows
  // with live ones.
  const split = diffView === DiffViews.SPLIT && canPairSides && !isGuest;
  const resolvedView = split ? DiffViews.SPLIT : DiffViews.UNIFIED;

  // A guest table's pairs stay zipped for emphasis: a deleted row has no
  // owner there, so unzipping would split every replacement.
  const pairRows = useCallback(
    () =>
      unzipPairsByOwner(pairSplitRows(rows), (index) =>
        isGuest ? undefined : spanOwnerByRow.get(index),
      ),
    [rows, spanOwnerByRow, isGuest],
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
    () => [...new Set(spanOwnerByRow.values())].toSorted(),
    [spanOwnerByRow],
  );
  const ownerChunks = guest?.owners?.chunks ?? lineOwners?.chunks;
  const ownerChunkById = useMemo(
    () => new Map(ownerChunks?.map((owner) => [owner.id, owner])),
    [ownerChunks],
  );
  // Once per row set, not per render: a drag re-renders the table on every
  // row the pointer crosses, and the owner's diff scan is per span row.
  const commentableSpanRows = useMemo(() => {
    if (isGuest) {
      return new Set(spanOwnerByRow.keys());
    }
    const commentable = new Set<number>();
    for (const [index, owner] of spanOwnerByRow) {
      const line = rows[index];
      if (line === undefined) {
        continue;
      }
      if (isSpanRowCommentable(line, ownerChunkById.get(owner))) {
        commentable.add(index);
      }
    }
    return commentable;
  }, [rows, spanOwnerByRow, ownerChunkById, isGuest]);
  const pairPartners = useMemo(() => buildPairPartners(pairs), [pairs]);
  // Unified pairs the same rows for emphasis without rendering them paired.
  const emphasisByRow = useMemo(
    () => computeIntraLineEmphasis(split ? pairs : pairRows(), tokensByRow),
    [pairs, pairRows, split, tokensByRow],
  );

  return {
    isGuest,
    guestByRow,
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
