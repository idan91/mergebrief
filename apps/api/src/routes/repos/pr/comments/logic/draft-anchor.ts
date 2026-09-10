import { ReviewCommentSides, type ReviewCommentSide } from "github";
import {
  CommentAnchorKinds,
  DraftCommentSides,
  type ReviewDraftCommentRow,
  type DraftCommentSide,
} from "persistence";

/** The stored side vocabulary as GitHub names it. */
export const SideOnGithub: Readonly<
  Record<DraftCommentSide, ReviewCommentSide>
> = {
  [DraftCommentSides.OLD]: ReviewCommentSides.LEFT,
  [DraftCommentSides.NEW]: ReviewCommentSides.RIGHT,
};

/** A stored draft as GitHub's inline-comment coordinates. */
export function readDraftAnchor(draft: ReviewDraftCommentRow): {
  path: string;
  line: number;
  side: ReviewCommentSide;
  startLine?: number;
  startSide?: ReviewCommentSide;
} {
  if (draft.anchor.kind !== CommentAnchorKinds.LINE) {
    throw new Error("file-arm draft reached line submit shaping");
  }
  const { anchor } = draft;
  const githubAnchor: ReturnType<typeof readDraftAnchor> = {
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
