import {
  ReviewSubjectTypes,
  type AddReviewThreadInput,
  type CreateInlineReviewCommentInput,
  type CreateLineInlineReviewCommentInput,
  type LineReviewThreadInput,
  type RepoScoped,
} from "github";
import { CommentAnchorKinds, type Mutable } from "types";
import { SideOnGithub } from "../consts";
import type {
  CommentPin,
  FileGitHubAnchor,
  GitHubAnchor,
  LineGitHubAnchor,
  PublishableDraft,
  PublishComment,
} from "../types";

export function isFileGitHubAnchor(
  anchor: GitHubAnchor,
): anchor is FileGitHubAnchor {
  return (
    "subjectType" in anchor && anchor.subjectType === ReviewSubjectTypes.FILE
  );
}

/** The one mapping from a stored anchor to GitHub's line and side fields. */
export function readGitHubAnchor(draft: PublishableDraft): GitHubAnchor {
  const { anchor } = draft;
  if (anchor.kind === CommentAnchorKinds.FILE) {
    return { path: anchor.file, subjectType: ReviewSubjectTypes.FILE };
  }

  const githubAnchor: Mutable<LineGitHubAnchor> = {
    path: anchor.file,
    line: anchor.endLine,
    side: SideOnGithub[anchor.side],
  };
  // A two-side range is multi-line by definition; same-side needs the span.
  const multiLine =
    anchor.startSide !== undefined || anchor.startLine < anchor.endLine;
  if (multiLine) {
    githubAnchor.startLine = anchor.startLine;
    githubAnchor.startSide = SideOnGithub[anchor.startSide ?? anchor.side];
  }
  return githubAnchor;
}

export function shapePublishComment(draft: PublishableDraft): PublishComment {
  return { anchor: readGitHubAnchor(draft), body: draft.body };
}

/** The REST input for one comment posted on its own; the binding names the repo. */
export function shapeInlineCommentInput(
  comment: PublishComment,
  pin: CommentPin,
): RepoScoped<CreateInlineReviewCommentInput> {
  const { anchor } = comment;
  if (isFileGitHubAnchor(anchor)) {
    return {
      prNumber: pin.prNumber,
      commitId: pin.commitId,
      path: anchor.path,
      body: comment.body,
      subjectType: anchor.subjectType,
    };
  }

  const input: Mutable<RepoScoped<CreateLineInlineReviewCommentInput>> = {
    prNumber: pin.prNumber,
    commitId: pin.commitId,
    path: anchor.path,
    line: anchor.line,
    side: anchor.side,
    body: comment.body,
  };
  if (anchor.startLine !== undefined) {
    input.startLine = anchor.startLine;
  }
  if (anchor.startSide !== undefined) {
    input.startSide = anchor.startSide;
  }
  return input;
}

/** The GraphQL input for one comment as a thread on a pending review. */
export function shapeThreadInput(
  reviewNodeId: string,
  comment: PublishComment,
): AddReviewThreadInput {
  const { anchor } = comment;
  if (isFileGitHubAnchor(anchor)) {
    return {
      reviewNodeId,
      subjectType: ReviewSubjectTypes.FILE,
      path: anchor.path,
      body: comment.body,
    };
  }

  const thread: Mutable<LineReviewThreadInput> = {
    reviewNodeId,
    subjectType: ReviewSubjectTypes.LINE,
    path: anchor.path,
    line: anchor.line,
    side: anchor.side,
    body: comment.body,
  };
  if (anchor.startLine !== undefined) {
    thread.startLine = anchor.startLine;
  }
  if (anchor.startSide !== undefined) {
    thread.startSide = anchor.startSide;
  }
  return thread;
}
