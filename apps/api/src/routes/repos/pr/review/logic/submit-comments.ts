// The draft→review-comment shaping and the degradation fold: every comment
// becomes a quoted block in the review body when GitHub 422s the anchors.
import {
  ReviewCommentSides,
  ReviewSubjectTypes,
  type LineReviewCommentInput,
  type ReviewCommentInput,
  type ReviewCommentSide,
} from "github";
import {
  DraftCommentSides,
  type ReviewDraftCommentRow,
  type DraftCommentSide,
} from "persistence";
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
    if (isFileSubmitComment(comment)) {
      return {
        path: comment.path,
        body: comment.body,
        subjectType: ReviewSubjectTypes.FILE,
      };
    }
    const primitive: Mutable<LineReviewCommentInput> = {
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
