import {
  ReviewCommentSides,
  ReviewSubjectTypes,
  type CreateInlineReviewCommentInput,
  type CreateLineInlineReviewCommentInput,
  type ReviewCommentSide,
} from "github";
import {
  DraftCommentSides,
  type ReviewDraftCommentRow,
  type DraftCommentSide,
} from "persistence";
import { CommentAnchorKinds, type Mutable } from "types";

/** The stored side vocabulary as GitHub names it. */
export const SideOnGithub: Readonly<
  Record<DraftCommentSide, ReviewCommentSide>
> = {
  [DraftCommentSides.OLD]: ReviewCommentSides.LEFT,
  [DraftCommentSides.NEW]: ReviewCommentSides.RIGHT,
};

export interface LineDraftAnchorCoords {
  readonly path: string;
  readonly line: number;
  readonly side: ReviewCommentSide;
  readonly startLine?: number;
  readonly startSide?: ReviewCommentSide;
}

export interface FileDraftAnchorCoords {
  readonly path: string;
  readonly subjectType: typeof ReviewSubjectTypes.FILE;
}

/** A stored draft as GitHub's inline-comment coordinates. */
export type DraftAnchorCoords = LineDraftAnchorCoords | FileDraftAnchorCoords;

function isFileDraftAnchorCoords(
  coords: DraftAnchorCoords,
): coords is FileDraftAnchorCoords {
  return (
    "subjectType" in coords && coords.subjectType === ReviewSubjectTypes.FILE
  );
}

export function readDraftAnchor(
  draft: ReviewDraftCommentRow,
): DraftAnchorCoords {
  const { anchor } = draft;
  if (anchor.kind === CommentAnchorKinds.FILE) {
    return {
      path: anchor.file,
      subjectType: ReviewSubjectTypes.FILE,
    };
  }
  const githubAnchor: Mutable<LineDraftAnchorCoords> = {
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

export interface InlineCommentPin {
  readonly owner: string;
  readonly repo: string;
  readonly prNumber: number;
  readonly commitId: string;
}

/** The draft plus the write pin, as createInlineReviewComment takes it. */
export function shapeInlineCommentWrite(
  draft: ReviewDraftCommentRow,
  pin: InlineCommentPin,
): CreateInlineReviewCommentInput {
  const coords = readDraftAnchor(draft);
  if (isFileDraftAnchorCoords(coords)) {
    return {
      owner: pin.owner,
      repo: pin.repo,
      prNumber: pin.prNumber,
      commitId: pin.commitId,
      path: coords.path,
      body: draft.body,
      subjectType: coords.subjectType,
    };
  }
  const input: Mutable<CreateLineInlineReviewCommentInput> = {
    owner: pin.owner,
    repo: pin.repo,
    prNumber: pin.prNumber,
    commitId: pin.commitId,
    path: coords.path,
    line: coords.line,
    side: coords.side,
    body: draft.body,
  };
  if (coords.startLine !== undefined) input.startLine = coords.startLine;
  if (coords.startSide !== undefined) input.startSide = coords.startSide;
  return input;
}
