// The draft to review-thread shaping and the partial fold: a comment whose
// anchor GitHub rejects becomes a quoted block in the review body.
import {
  ReviewCommentSides,
  ReviewSubjectTypes,
  type AddReviewThreadInput,
  type LineReviewThreadInput,
  type ReviewCommentSide,
} from "github";
import type { ReviewDraftCommentRow } from "persistence";
import { DraftCommentSides, type DraftCommentSide } from "types/comments";
import { CommentAnchorKinds, type Mutable } from "types";

/** The stored side vocabulary as GitHub names it. */
const SideOnGithub: Readonly<Record<DraftCommentSide, ReviewCommentSide>> = {
  [DraftCommentSides.OLD]: ReviewCommentSides.LEFT,
  [DraftCommentSides.NEW]: ReviewCommentSides.RIGHT,
};

export interface LineSubmitComment {
  readonly path: string;
  readonly line: number;
  readonly side: ReviewCommentSide;
  readonly startLine?: number;
  readonly startSide?: ReviewCommentSide;
  readonly body: string;
}

export interface FileSubmitComment {
  readonly path: string;
  readonly body: string;
  readonly subjectType: typeof ReviewSubjectTypes.FILE;
}

/** One held draft as the review's comment payload. */
export type SubmitComment = LineSubmitComment | FileSubmitComment;

function isFileSubmitComment(
  comment: SubmitComment,
): comment is FileSubmitComment {
  return (
    "subjectType" in comment && comment.subjectType === ReviewSubjectTypes.FILE
  );
}

export function shapeSubmitComment(
  draft: ReviewDraftCommentRow,
): SubmitComment {
  const { anchor } = draft;
  if (anchor.kind === CommentAnchorKinds.FILE) {
    return {
      path: anchor.file,
      body: draft.body,
      subjectType: ReviewSubjectTypes.FILE,
    };
  }
  const comment: Mutable<LineSubmitComment> = {
    path: anchor.file,
    line: anchor.endLine,
    side: SideOnGithub[anchor.side],
    body: draft.body,
  };
  // A two-side range is multi-line by definition; same-side needs the span.
  const multiLine =
    anchor.startSide !== undefined || anchor.startLine < anchor.endLine;
  if (multiLine) {
    comment.startLine = anchor.startLine;
    comment.startSide = SideOnGithub[anchor.startSide ?? anchor.side];
  }
  return comment;
}

function foldedCommentBlock(comment: SubmitComment): string {
  if (isFileSubmitComment(comment)) {
    return [`**\`${comment.path}\`**`, "", comment.body].join("\n");
  }
  const twoSide =
    comment.startSide !== undefined && comment.startSide !== comment.side;
  let range = String(comment.line);
  if (twoSide) {
    // Cross-side line numbers need their sides spelled out to mean anything.
    range = `${comment.startSide} ${comment.startLine}-${comment.side} ${comment.line}`;
  } else if (comment.startLine !== undefined) {
    range = `${comment.startLine}-${comment.line}`;
  }
  return [`**\`${comment.path}:${range}\`**`, "", comment.body].join("\n");
}

/**
 * The review body with the rejected comments folded in as quoted blocks.
 * Nothing rejected returns the body as given, `undefined` included.
 */
export function foldCommentsIntoBody(
  body: string | undefined,
  rejected: readonly SubmitComment[],
  total: number,
): string | undefined {
  if (rejected.length === 0) {
    return body;
  }
  const preamble = `${String(rejected.length)} of ${String(total)} comments could not be anchored to the diff and were folded into this review body (nothing was dropped):`;
  const sections: string[] = [];
  if (body !== undefined && body.trim() !== "") {
    sections.push(body);
  }
  sections.push("---", preamble, ...rejected.map(foldedCommentBlock));
  return sections.join("\n\n");
}

/** The thread-mutation input for one comment on a pending review. */
export function toThreadInput(
  reviewNodeId: string,
  comment: SubmitComment,
): AddReviewThreadInput {
  if (isFileSubmitComment(comment)) {
    return {
      reviewNodeId,
      subjectType: ReviewSubjectTypes.FILE,
      path: comment.path,
      body: comment.body,
    };
  }
  const thread: Mutable<LineReviewThreadInput> = {
    reviewNodeId,
    subjectType: ReviewSubjectTypes.LINE,
    path: comment.path,
    line: comment.line,
    side: comment.side,
    body: comment.body,
  };
  if (comment.startLine !== undefined) {
    thread.startLine = comment.startLine;
  }
  if (comment.startSide !== undefined) {
    thread.startSide = comment.startSide;
  }
  return thread;
}
