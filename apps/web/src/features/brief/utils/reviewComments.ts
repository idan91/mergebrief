import type { DiffLine } from "@web/utils/diffTokens/types";
import type { AddressedReviewComment, BriefChunk } from "../types";

export function pathOnlyFileCommentsForChunk(
  comments: AddressedReviewComment[],
  chunk: BriefChunk,
): AddressedReviewComment[] {
  return comments.filter(
    (comment) =>
      comment.file === chunk.file &&
      comment.line === null &&
      comment.originalLine === null,
  );
}

export function reviewCommentsForChunk(
  comments: AddressedReviewComment[],
  chunk: BriefChunk,
): AddressedReviewComment[] {
  if (chunk.addressesComments?.length) {
    const byId = new Map(comments.map((comment) => [comment.id, comment]));
    return chunk.addressesComments
      .map((commentId) => byId.get(commentId))
      .filter((comment): comment is AddressedReviewComment => Boolean(comment));
  }

  const sameFileComments = comments.filter(
    (comment) => comment.file === chunk.file,
  );
  return sameFileComments.filter((comment) =>
    reviewCommentBelongsToChunk(comment, chunk),
  );
}

export function reviewCommentMatchesDiffLine(
  comment: AddressedReviewComment,
  chunkFile: string,
  line: DiffLine,
  _chunkDiff: DiffLine[] = [],
): boolean {
  if (line.kind === "hunk" || line.kind === "note") {
    return false;
  }
  if (comment.file !== chunkFile) {
    return false;
  }
  if (comment.line !== null) {
    return line.newLine === comment.line;
  }
  if (comment.originalLine !== null) {
    return line.oldLine === comment.originalLine;
  }
  return false;
}

function reviewCommentBelongsToChunk(
  comment: AddressedReviewComment,
  chunk: BriefChunk,
): boolean {
  const currentLine = comment.line;
  if (currentLine !== null) {
    return lineInRanges(currentLine, chunk.addedRanges);
  }

  const originalLine = comment.originalLine;
  if (originalLine === null) {
    return false;
  }
  return (
    lineInRanges(originalLine, chunk.removedRanges) ||
    lineInRanges(originalLine, chunk.addedRanges)
  );
}

function lineInRanges(
  line: number,
  ranges: BriefChunk["addedRanges"],
): boolean {
  return ranges.some((range) => line >= range.start && line <= range.end);
}
