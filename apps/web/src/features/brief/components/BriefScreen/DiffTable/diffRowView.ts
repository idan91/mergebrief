import {
  rowId,
  type CommentAnchor,
  type ReviewComment,
} from "@web/features/review/utils/comments";
import { reviewCommentMatchesDiffLine } from "../../../utils/reviewComments";
import {
  type ChunkComparisonView,
  type ComparisonRowKind,
  type ComparisonRun,
} from "../../../comparison/comparison";
import type {
  AddressedReviewComment,
  BriefChunk,
  DiffLine,
} from "../../../types";

export interface DiffRowViewParams {
  line: DiffLine;
  index: number;
  chunk: BriefChunk;
  overlayActive: boolean;
  comparisonView: ChunkComparisonView;
  comments: ReviewComment[];
  addressedComments: AddressedReviewComment[];
  dragIndexes: number[];
  activeRowIds: Set<string>;
  activeCommentAnchor: CommentAnchor | null;
}

export interface DiffRowView {
  sign: string;
  id: string;
  revRun: ComparisonRun | undefined;
  revMark: ComparisonRowKind | undefined;
  isRevStart: boolean;
  isRevEnd: boolean;
  rowComments: ReviewComment[];
  rowAddressedComments: AddressedReviewComment[];
  isSelected: boolean;
  showComposer: boolean;
}

/** Derives everything a commentable diff row needs to render. Pure — no DOM, no React. */
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
}: DiffRowViewParams): DiffRowView {
  const sign = line.kind === "add" ? "+" : line.kind === "del" ? "−" : " ";
  const id = rowId(chunk.id, index);
  const revRun = overlayActive ? comparisonView.runByRow.get(index) : undefined;
  const revMark = overlayActive ? comparisonView.marks.get(index) : undefined;
  const isRevStart = revRun !== undefined && revRun.rowIndexes[0] === index;
  const isRevEnd = revRun !== undefined && revRun.rowIndexes.at(-1) === index;
  const rowComments = comments.filter(
    (comment) => comment.anchor.rowIds.at(-1) === id,
  );
  const rowAddressedComments = addressedComments.filter((comment) =>
    reviewCommentMatchesDiffLine(comment, chunk.file, line, chunk.diff),
  );
  const isSelected = dragIndexes.includes(index) || activeRowIds.has(id);
  const showComposer =
    activeCommentAnchor?.chunkId === chunk.id &&
    activeCommentAnchor.rowIds.at(-1) === id;

  return {
    sign,
    id,
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
