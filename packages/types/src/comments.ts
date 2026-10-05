import type { ValueOf } from "./utils";

export const CommentAnchorKinds = {
  LINE: "line",
  FILE: "file",
} as const;

export type CommentAnchorKind = ValueOf<typeof CommentAnchorKinds>;

export const DraftCommentStatuses = {
  DRAFT: "draft",
  SUBMITTED: "submitted",
} as const;
export type DraftCommentStatus = ValueOf<typeof DraftCommentStatuses>;

/**
 * The diff side a draft comment's coordinates address. The client's
 * vocabulary, mapped to GitHub's LEFT/RIGHT only at submit.
 */
export const DraftCommentSides = {
  OLD: "old",
  NEW: "new",
} as const;
export type DraftCommentSide = ValueOf<typeof DraftCommentSides>;

/**
 * Carry-over verdict on a draft comment's coordinates. Null means the anchor
 * still holds exactly.
 */
export const AnchorStatuses = {
  MOVED: "moved",
  ORPHANED: "orphaned",
} as const;
export type AnchorStatus = ValueOf<typeof AnchorStatuses>;
