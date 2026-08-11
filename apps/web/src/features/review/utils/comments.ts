import type { TFunction } from "i18next";

import type { SuggestionDiffRow } from "@web/components/Markdown/utils";
import type { DiffLine } from "../../brief/types";

export type CommentSide = "old" | "new";

export interface CommentAnchor {
  chunkId: string;
  file: string;
  side: CommentSide;
  startLine: number;
  endLine: number;
  rowIds: string[];
  selectedText: string;
}

export interface ReviewComment {
  id: string;
  anchor: CommentAnchor;
  body: string;
  status: "draft" | "submitted";
  collapsed: boolean;
}

export function createCommentAnchor(
  chunkId: string,
  file: string,
  rows: DiffLine[],
  selectedIndexes: number[],
): CommentAnchor | null {
  const orderedIndexes = [...new Set(selectedIndexes)].toSorted(
    (left, right) => left - right,
  );
  if (orderedIndexes.length === 0) return null;
  if (!isContinuous(orderedIndexes)) return null;

  const selectedRows = orderedIndexes.map((index) => rows[index]);
  if (
    selectedRows.some(
      (row) => !row || row.kind === "hunk" || row.kind === "note",
    )
  )
    return null;

  const hasAdd = selectedRows.some((row) => row?.kind === "add");
  const hasDel = selectedRows.some((row) => row?.kind === "del");
  if (hasAdd && hasDel) return null;

  const side: CommentSide = hasDel ? "old" : "new";
  const lineNumbers = selectedRows.map((row) => lineForSide(row, side));
  if (lineNumbers.some((line) => typeof line !== "number")) return null;

  const concreteLines = lineNumbers.filter(
    (line): line is number => typeof line === "number",
  );
  const startLine = concreteLines[0];
  const endLine = concreteLines.at(-1);
  if (typeof startLine !== "number" || typeof endLine !== "number") return null;

  return {
    chunkId,
    file,
    side,
    startLine,
    endLine,
    rowIds: orderedIndexes.map((index) => rowId(chunkId, index)),
    selectedText: selectedRows.map((row) => row?.content ?? "").join("\n"),
  };
}

export function rowId(chunkId: string, rowIndex: number): string {
  return `${chunkId}:${rowIndex}`;
}

export function buildSuggestionDiffRows(
  anchor: CommentAnchor,
  suggestionText: string,
): SuggestionDiffRow[] {
  return [
    ...splitDiffText(anchor.selectedText).map(
      (content, index) =>
        ({
          kind: "del",
          ...suggestionLineNumber(anchor, index),
          content,
        }) satisfies SuggestionDiffRow,
    ),
    ...splitDiffText(suggestionText).map(
      (content, index) =>
        ({
          kind: "add",
          ...suggestionLineNumber(anchor, index),
          content,
        }) satisfies SuggestionDiffRow,
    ),
  ];
}

/**
 * Mirrors of the post-now route's Zod caps — keep in lockstep. An over-cap
 * payload is a deterministic 400 there and the UI would resubmit the same
 * draft, so it must block HERE with recoverable copy instead.
 */
export const MAX_POSTED_COMMENT_LENGTH = 65_536;
export const MAX_POSTED_COMMENT_PATH_LENGTH = 1_024;

/**
 * Why post-now is blocked for this draft, or `undefined` when it may proceed.
 * Checked both at the Post affordance (disabled with the reason) and in the
 * post handler (belt and braces for programmatic/keyboard paths).
 */
export function postCommentBlockedReason(
  t: TFunction,
  comment: Pick<ReviewComment, "anchor" | "body">,
): string | undefined {
  if (comment.body.length > MAX_POSTED_COMMENT_LENGTH) {
    return t("review.comment.tooLongToPost", {
      max: MAX_POSTED_COMMENT_LENGTH,
    });
  }
  if (comment.anchor.file.length > MAX_POSTED_COMMENT_PATH_LENGTH) {
    // Mirrors submitBlockedReason's overlong-path copy: no edit can fix the
    // anchor's path, so the only recovery is deleting the draft.
    return t("review.comment.pathTooLongToPost");
  }
  return undefined;
}

export function reviewCommentSubmitLabel(
  t: TFunction,
  existingCommentCount: number,
): string {
  return existingCommentCount === 0
    ? t("review.comment.startReview")
    : t("review.comment.addReviewComment");
}

export function commentAnchorLabel(anchor: CommentAnchor): string {
  const sign = anchor.side === "new" ? "+" : "-";
  const range =
    anchor.startLine === anchor.endLine
      ? `${sign}${anchor.startLine}`
      : `${sign}${anchor.startLine}-${anchor.endLine}`;
  return `${anchor.file} · ${range}`;
}

function lineForSide(
  row: DiffLine | undefined,
  side: CommentSide,
): number | undefined {
  if (!row) return undefined;
  return side === "old" ? row.oldLine : row.newLine;
}

function isContinuous(indexes: number[]): boolean {
  return indexes.every((index, position) => {
    if (position === 0) return true;
    const previous = indexes[position - 1];
    return previous !== undefined && index === previous + 1;
  });
}

function suggestionLineNumber(
  anchor: CommentAnchor,
  lineOffset: number,
): Pick<SuggestionDiffRow, "oldLine" | "newLine"> {
  const line = anchor.startLine + lineOffset;
  return anchor.side === "old" ? { oldLine: line } : { newLine: line };
}

function splitDiffText(text: string): string[] {
  if (text.length === 0) return [""];
  return text.split("\n");
}
