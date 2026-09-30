import { type DiffLine, DiffLineKinds } from "@web/utils/diffTokens/types";
import type { TFunction } from "i18next";

import type { SuggestionDiffRow } from "@web/components/Markdown/utils";
import {
  CommentAnchorKinds,
  type CommentAnchorKind,
  type ValueOf,
} from "types";

export const CommentSides = {
  OLD: "old",
  NEW: "new",
} as const;
export type CommentSide = ValueOf<typeof CommentSides>;

export interface CommentAnchorBase {
  kind: CommentAnchorKind;
  file: string;
}

export interface LineCommentAnchor extends CommentAnchorBase {
  kind: typeof CommentAnchorKinds.LINE;
  chunkId: string;
  side: CommentSide;
  /** Present only when the range genuinely crosses sides. */
  startSide?: CommentSide;
  startLine: number;
  endLine: number;
  rowIds: string[];
  selectedText: string;
}

/**
 * The lines a reader picked, the shape of a line anchor without a comment's
 * own fields. `chunkId` is the table that shows it; a selection never spans
 * chunks. `rowIds` follow the anchor's convention for the rows it covers.
 */
export interface LineSelection {
  chunkId: string;
  file: string;
  side: CommentSide;
  /** Present only when the range genuinely crosses sides. */
  startSide?: CommentSide;
  startLine: number;
  endLine: number;
  rowIds: string[];
}

/** What a line link names: the chunk and its lines, the file being the chunk's. */
export type LineLinkTarget = Omit<LineSelection, "file" | "rowIds">;

export interface FileCommentAnchor extends CommentAnchorBase {
  kind: typeof CommentAnchorKinds.FILE;
}

export type CommentAnchor = LineCommentAnchor | FileCommentAnchor;

export const ReviewCommentStatuses = {
  DRAFT: "draft",
  SUBMITTED: "submitted",
} as const;
export type ReviewCommentStatus = ValueOf<typeof ReviewCommentStatuses>;

export interface ReviewComment {
  id: string;
  anchor: CommentAnchor;
  body: string;
  status: ReviewCommentStatus;
  collapsed: boolean;
}

export function listDraftComments(
  comments: readonly ReviewComment[],
): ReviewComment[] {
  return comments.filter(
    (comment) => comment.status === ReviewCommentStatuses.DRAFT,
  );
}

/** The draft with this id; a submitted comment of the same id is not one. */
export function findDraftComment(
  comments: readonly ReviewComment[],
  id: string | null,
): ReviewComment | undefined {
  if (id === null) {
    return undefined;
  }
  return comments.find(
    (comment) =>
      comment.id === id && comment.status === ReviewCommentStatuses.DRAFT,
  );
}

export function countDraftComments(comments: readonly ReviewComment[]): number {
  return listDraftComments(comments).length;
}

export function isLineCommentAnchor(
  anchor: CommentAnchor,
): anchor is LineCommentAnchor {
  return anchor.kind === CommentAnchorKinds.LINE;
}

export function isFileCommentAnchor(
  anchor: CommentAnchor,
): anchor is FileCommentAnchor {
  return anchor.kind === CommentAnchorKinds.FILE;
}

export function createFileCommentAnchor(file: string): FileCommentAnchor {
  return { kind: CommentAnchorKinds.FILE, file };
}

export function createCommentAnchor(
  chunkId: string,
  file: string,
  rows: DiffLine[],
  selectedIndexes: number[],
): LineCommentAnchor | null {
  const orderedIndexes = [...new Set(selectedIndexes)].toSorted(
    (left, right) => left - right,
  );
  if (orderedIndexes.length === 0) return null;
  if (!isContinuous(orderedIndexes)) return null;

  const selectedRows = orderedIndexes.map((index) => rows[index]);
  if (
    selectedRows.some(
      (row) =>
        !row ||
        row.kind === DiffLineKinds.HUNK ||
        row.kind === DiffLineKinds.NOTE,
    )
  )
    return null;

  // Each endpoint anchors on its own side: a removed row against the old
  // file, anything else against the new. A selection whose endpoints agree
  // is the single-side shape; endpoints on different sides cross.
  const first = selectedRows[0];
  const last = selectedRows.at(-1);
  if (first === undefined || last === undefined) return null;
  const startSide = getRowSide(first);
  const side = getRowSide(last);
  const startLine = lineForSide(first, startSide);
  const endLine = lineForSide(last, side);
  if (typeof startLine !== "number" || typeof endLine !== "number") return null;

  const anchor: LineCommentAnchor = {
    kind: CommentAnchorKinds.LINE,
    chunkId,
    file,
    side,
    startLine,
    endLine,
    rowIds: orderedIndexes.map((index) => rowId(chunkId, index)),
    selectedText: selectedRows.map((row) => row?.content ?? "").join("\n"),
  };
  if (startSide !== side) {
    anchor.startSide = startSide;
  }
  return anchor;
}

/**
 * A range that stays on one side of a split diff anchors on that side's line
 * numbers, context rows included, the way a same-side GitHub selection does.
 */
export function createSideAnchor(
  chunkId: string,
  file: string,
  rows: DiffLine[],
  selectedIndexes: number[],
  side: CommentSide,
): LineCommentAnchor | null {
  const orderedIndexes = [...new Set(selectedIndexes)].toSorted(
    (left, right) => left - right,
  );
  if (orderedIndexes.length === 0) return null;

  const selectedRows = orderedIndexes.map((index) => rows[index]);
  const sideLines = selectedRows.map((row) => lineForSide(row, side));
  if (!isConsecutiveRun(sideLines)) return null;
  const startLine = sideLines[0];
  const endLine = sideLines.at(-1);
  if (typeof startLine !== "number" || typeof endLine !== "number") return null;

  return {
    kind: CommentAnchorKinds.LINE,
    chunkId,
    file,
    side,
    startLine,
    endLine,
    rowIds: orderedIndexes.map((index) => rowId(chunkId, index)),
    selectedText: selectedRows.map((row) => row?.content ?? "").join("\n"),
  };
}

/**
 * The lines an anchor covers: its rows when the table that made it had
 * them, else its span, which is one-sided for an anchor with no rows.
 */
export function countAnchorLines(anchor: LineCommentAnchor): number {
  if (anchor.rowIds.length > 0) {
    return anchor.rowIds.length;
  }

  return anchor.endLine - anchor.startLine + 1;
}

/** Every entry numbered and each one more than the last: no header crossed. */
function isConsecutiveRun(lines: (number | undefined)[]): lines is number[] {
  return lines.every((line, at) => {
    if (typeof line !== "number") return false;
    const previous = lines[at - 1];
    return at === 0 || previous === line - 1;
  });
}

function getRowSide(row: DiffLine): CommentSide {
  return row.kind === DiffLineKinds.DEL ? CommentSides.OLD : CommentSides.NEW;
}

export function rowId(chunkId: string, rowIndex: number): string {
  return `${chunkId}:${rowIndex}`;
}

export interface ChunkLocator {
  readonly id: string;
  readonly file: string;
}

/**
 * The chunk a comment jumps to. Line comments name their chunk; a File
 * comment names the first Brief chunk for that path, never an invented id.
 */
export function resolveJumpChunkId(
  comment: ReviewComment,
  chunks: readonly ChunkLocator[],
): string {
  if (isLineCommentAnchor(comment.anchor)) return comment.anchor.chunkId;
  return chunks.find((chunk) => chunk.file === comment.anchor.file)?.id ?? "";
}

export function buildSuggestionDiffRows(
  anchor: CommentAnchor,
  suggestionText: string,
): SuggestionDiffRow[] {
  if (!isLineCommentAnchor(anchor)) return [];
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
 * Mirrors of the post-now route's Zod caps. Keep in lockstep. An over-cap
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

function getSignForSide(side: CommentSide): string {
  return side === CommentSides.NEW ? "+" : "-";
}

export function commentAnchorLabel(
  t: TFunction,
  anchor: CommentAnchor,
): string {
  if (isFileCommentAnchor(anchor)) {
    return t("review.comment.addCommentOnFile");
  }
  const sign = getSignForSide(anchor.side);
  if (anchor.startSide !== undefined && anchor.startSide !== anchor.side) {
    // Each endpoint carries its own sign; bare numbers would lie about sides.
    const range = t("review.comment.anchorCross", {
      start: `${getSignForSide(anchor.startSide)}${anchor.startLine}`,
      end: `${sign}${anchor.endLine}`,
    });
    return `${anchor.file} · ${range}`;
  }
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
  return side === CommentSides.OLD ? row.oldLine : row.newLine;
}

function isContinuous(indexes: number[]): boolean {
  return indexes.every((index, position) => {
    if (position === 0) return true;
    const previous = indexes[position - 1];
    return previous !== undefined && index === previous + 1;
  });
}

function suggestionLineNumber(
  anchor: LineCommentAnchor,
  lineOffset: number,
): Pick<SuggestionDiffRow, "oldLine" | "newLine"> {
  // A crossing range has no single side to number from: counting from
  // startLine on `side` would put one side's numbers in the other's gutter.
  if (anchor.startSide !== undefined && anchor.startSide !== anchor.side) {
    return {};
  }
  const line = anchor.startLine + lineOffset;
  return anchor.side === CommentSides.OLD
    ? { oldLine: line }
    : { newLine: line };
}

function splitDiffText(text: string): string[] {
  if (text.length === 0) return [""];
  return text.split("\n");
}
