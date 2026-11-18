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
 * The side of a diff a line belongs to: draft comment coordinates and the
 * client's diff rendering. Mapped to GitHub's LEFT/RIGHT only at submit.
 */
export const DiffSides = {
  OLD: "old",
  NEW: "new",
} as const;
export type DiffSide = ValueOf<typeof DiffSides>;

/**
 * Carry-over verdict on a draft comment's coordinates. Null means the anchor
 * still holds exactly.
 */
export const AnchorStatuses = {
  MOVED: "moved",
  ORPHANED: "orphaned",
} as const;
export type AnchorStatus = ValueOf<typeof AnchorStatuses>;
