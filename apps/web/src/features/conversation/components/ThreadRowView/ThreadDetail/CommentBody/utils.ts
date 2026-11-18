import { CommentBodyStates, type CommentBodyState } from "./types";

export function deriveCommentBodyState(
  overflowing: boolean,
  expanded: boolean,
): CommentBodyState {
  if (!overflowing) {
    return CommentBodyStates.WHOLE;
  }
  return expanded ? CommentBodyStates.EXPANDED : CommentBodyStates.CLAMPED;
}
