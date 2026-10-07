import {
  DiffLineKinds,
  DiffRowOrigins,
  type DiffLine,
} from "@web/utils/diffTokens/types";
import {
  isLineCommentAnchor,
  rowId,
  type CommentAnchor,
  type LineCommentAnchor,
  type ReviewComment,
} from "@web/features/review/utils";
import { reviewCommentMatchesDiffLine } from "../../../utils/reviewComments";
import {
  type ChunkComparisonView,
  type ComparisonRowKind,
  type ComparisonRun,
} from "../../../comparison/runs";
import type {
  AddressedReviewComment,
  BriefChunk,
  GuestRowReason,
} from "../../../types";

export interface DiffRowViewParams {
  line: DiffLine;
  index: number;
  chunk: BriefChunk;
  overlayActive: boolean;
  comparisonView: ChunkComparisonView;
  comments: ReviewComment[];
  addressedComments: AddressedReviewComment[];
  dragIndexes: ReadonlySet<number>;
  activeRowIds: Set<string>;
  activeCommentAnchor: CommentAnchor | null;
  /** Rows adopted by drafts that land on no rendered line, see below. */
  strandedRowIds: ReadonlyMap<string, string>;
}

export interface DiffRowView {
  id: string;
  revRun: ComparisonRun | undefined;
  revMark: ComparisonRowKind | undefined;
  isRevStart: boolean;
  isRevEnd: boolean;
  rowComments: ReviewComment[];
  rowAddressedComments: AddressedReviewComment[];
  isSelected: boolean;
  showComposer: boolean;
  /** GitHub rejects a comment on a line the diff does not carry. */
  isCommentable: boolean;
  /** Why a guest row takes no comment; absent on a commentable or a host row. */
  disabledReason?: GuestRowReason;
}

/**
 * Expanded context came from the file at head, not from the PR diff. An
 * expanded add or del row is another chunk's line of the same diff, so a
 * comment can anchor to it.
 */
export function isCommentableLine(line: DiffLine): boolean {
  if (line.origin !== DiffRowOrigins.EXPANDED) {
    return true;
  }

  return line.kind !== DiffLineKinds.CTX;
}

/**
 * Does this row carry the draft's last line? The fallback for a draft that
 * came from the server: row ids belong to the render that created them, and a
 * session read lands before the diff does, so the coordinates are all it has.
 */
export function anchorEndsOnRow(
  anchor: LineCommentAnchor,
  line: DiffLine,
): boolean {
  return resolveSideLine(line, anchor) === anchor.endLine;
}

function resolveSideLine(
  line: DiffLine,
  anchor: LineCommentAnchor,
): number | undefined {
  return anchor.side === "old" ? line.oldLine : line.newLine;
}

/**
 * A chunk's outer span includes gaps between hunks, where drafts match no row.
 * Keep those drafts visible on the last row at or before their end line,
 * or on the chunk's first row when no earlier row exists.
 */
export function resolveStrandedRows(
  chunk: BriefChunk,
  comments: ReviewComment[],
): Map<string, string> {
  const rows = chunk.diff ?? [];
  const stranded = new Map<string, string>();
  if (rows.length === 0) {
    return stranded;
  }
  for (const comment of comments) {
    const anchor = comment.anchor;
    if (!isLineCommentAnchor(anchor)) {
      continue;
    }
    if (anchor.rowIds.length > 0) {
      continue;
    }
    if (rows.some((line) => anchorEndsOnRow(anchor, line))) {
      continue;
    }
    let adopted = 0;
    for (const [index, line] of rows.entries()) {
      const value = resolveSideLine(line, anchor);
      if (value !== undefined && value <= anchor.endLine) {
        adopted = index;
      }
    }
    stranded.set(comment.id, rowId(chunk.id, adopted));
  }
  return stranded;
}

/** Derives everything a commentable diff row needs to render. Pure, no DOM, no React. */
export function getDiffRowView({
  line,
  index,
  chunk,
  overlayActive,
  comparisonView,
  comments,
  addressedComments,
  dragIndexes,
  activeRowIds,
  activeCommentAnchor,
  strandedRowIds,
}: DiffRowViewParams): DiffRowView {
  const id = rowId(chunk.id, index);
  const revRun = overlayActive ? comparisonView.runByRow.get(index) : undefined;
  const revMark = overlayActive ? comparisonView.marks.get(index) : undefined;
  const isRevStart = revRun !== undefined && revRun.rowIndexes[0] === index;
  const isRevEnd = revRun !== undefined && revRun.rowIndexes.at(-1) === index;
  const rowComments = comments.filter((comment) => {
    if (!isLineCommentAnchor(comment.anchor)) {
      return false;
    }
    if (comment.anchor.rowIds.length > 0) {
      return comment.anchor.rowIds.at(-1) === id;
    }
    if (anchorEndsOnRow(comment.anchor, line)) {
      return true;
    }
    return strandedRowIds.get(comment.id) === id;
  });
  const rowAddressedComments = addressedComments.filter((comment) =>
    reviewCommentMatchesDiffLine(comment, chunk.file, line, chunk.diff),
  );
  const isSelected = dragIndexes.has(index) || activeRowIds.has(id);
  const showComposer =
    activeCommentAnchor !== null &&
    isLineCommentAnchor(activeCommentAnchor) &&
    activeCommentAnchor.chunkId === chunk.id &&
    activeCommentAnchor.rowIds.at(-1) === id;

  return {
    id,
    isCommentable: isCommentableLine(line),
    revRun,
    revMark,
    isRevStart,
    isRevEnd,
    rowComments,
    rowAddressedComments,
    isSelected,
    showComposer,
  };
}
