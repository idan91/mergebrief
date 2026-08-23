// The draft→review-comment shaping and the degradation fold: every comment
// becomes a quoted block in the review body when GitHub 422s the anchors.
import { ReviewCommentSide, type ReviewCommentInput } from "github";
import { DraftCommentSide, type ReviewDraftCommentRow } from "persistence";
import type { Mutable } from "types";

/** The stored side vocabulary as GitHub names it. */
const SIDE_ON_GITHUB: Readonly<Record<DraftCommentSide, ReviewCommentSide>> = {
  [DraftCommentSide.OLD]: ReviewCommentSide.LEFT,
  [DraftCommentSide.NEW]: ReviewCommentSide.RIGHT,
};

/** One held draft as the review's comment payload. */
export interface SubmitComment {
  readonly path: string;
  readonly line: number;
  readonly side: ReviewCommentSide;
  readonly startLine?: number;
  readonly startSide?: ReviewCommentSide;
  readonly body: string;
}

export function shapeSubmitComment(
  draft: ReviewDraftCommentRow,
): SubmitComment {
  const comment: Mutable<SubmitComment> = {
    path: draft.filePath,
    line: draft.endLine,
    side: SIDE_ON_GITHUB[draft.side],
    body: draft.body,
  };
  // A two-side range is multi-line by definition; same-side needs the span.
  const multiLine = draft.startSide !== null || draft.startLine < draft.endLine;
  if (multiLine) {
    comment.startLine = draft.startLine;
    comment.startSide = SIDE_ON_GITHUB[draft.startSide ?? draft.side];
  }
  return comment;
}

function foldedCommentBlock(comment: SubmitComment): string {
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

/** The review body with every anchored comment folded in as a quoted block. */
export function foldCommentsIntoBody(
  body: string | undefined,
  comments: readonly SubmitComment[],
): string {
  const preamble =
    "The comments below could not be anchored to the diff and were folded into this review body (nothing was dropped):";
  const sections: string[] = [];
  if (body !== undefined && body.trim() !== "") {
    sections.push(body);
  }
  sections.push("---", preamble, ...comments.map(foldedCommentBlock));
  return sections.join("\n\n");
}

export function toPrimitiveComments(
  comments: readonly SubmitComment[],
): ReviewCommentInput[] {
  return comments.map((comment) => {
    const primitive: Mutable<ReviewCommentInput> = {
      path: comment.path,
      line: comment.line,
      side: comment.side,
      body: comment.body,
    };
    if (comment.startLine !== undefined) {
      primitive.startLine = comment.startLine;
    }
    if (comment.startSide !== undefined) {
      primitive.startSide = comment.startSide;
    }
    return primitive;
  });
}
