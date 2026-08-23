import { ReviewCommentSide } from "github";
import { DraftCommentSide, type ReviewDraftCommentRow } from "persistence";

/** The stored side vocabulary as GitHub names it. */
export const SIDE_ON_GITHUB: Readonly<
  Record<DraftCommentSide, ReviewCommentSide>
> = {
  [DraftCommentSide.OLD]: ReviewCommentSide.LEFT,
  [DraftCommentSide.NEW]: ReviewCommentSide.RIGHT,
};

/** A stored draft as GitHub's inline-comment coordinates. */
export function readDraftAnchor(draft: ReviewDraftCommentRow): {
  path: string;
  line: number;
  side: ReviewCommentSide;
  startLine?: number;
  startSide?: ReviewCommentSide;
} {
  const anchor: ReturnType<typeof readDraftAnchor> = {
    path: draft.filePath,
    line: draft.endLine,
    side: SIDE_ON_GITHUB[draft.side],
  };
  // A two-side range is multi-line by definition; same-side needs the span.
  const multiLine = draft.startSide !== null || draft.startLine < draft.endLine;
  if (multiLine) {
    anchor.startLine = draft.startLine;
    anchor.startSide = SIDE_ON_GITHUB[draft.startSide ?? draft.side];
  }
  return anchor;
}
