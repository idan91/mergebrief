import type { AddressedReviewComment, BriefChunk, DiffLine } from "./types";

export function reviewCommentsForChunk(comments: AddressedReviewComment[], chunk: BriefChunk): AddressedReviewComment[] {
  if (chunk.addressesComments?.length) {
    const byId = new Map(comments.map((comment) => [comment.id, comment]));
    return chunk.addressesComments.map((commentId) => byId.get(commentId)).filter((comment): comment is AddressedReviewComment => Boolean(comment));
  }

  const sameFileComments = comments.filter((comment) => comment.file === chunk.file);
  if (!chunk.diff?.length) return sameFileComments;
  return sameFileComments.filter((comment) => chunk.diff?.some((line) => reviewCommentMatchesDiffLine(comment, chunk.file, line, chunk.diff)) ?? false);
}

export function reviewCommentMatchesDiffLine(comment: AddressedReviewComment, chunkFile: string, line: DiffLine, chunkDiff: DiffLine[] = []): boolean {
  if (line.kind === "hunk" || line.kind === "note") return false;
  if (comment.file !== chunkFile) return false;
  if (comment.line != null) return line.newLine === comment.line;
  if (comment.originalLine != null) {
    if (line.oldLine === comment.originalLine) return true;
    const hasOldSideAnchor = chunkDiff.some((row) => row.kind !== "hunk" && row.kind !== "note" && row.oldLine === comment.originalLine);
    return !hasOldSideAnchor && line.kind === "add" && line.newLine === comment.originalLine;
  }
  return false;
}
