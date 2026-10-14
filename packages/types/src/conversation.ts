import type { ValueOf } from "./utils";

/** GitHub's wire values for a review comment's or a thread's diff side. */
export const ReviewCommentSides = {
  LEFT: "LEFT",
  RIGHT: "RIGHT",
} as const;
export type ReviewCommentSide = ValueOf<typeof ReviewCommentSides>;

/** GitHub's wire values for what a review thread anchors to. */
export const ThreadSubjectTypes = {
  LINE: "LINE",
  FILE: "FILE",
} as const;
export type ThreadSubjectType = ValueOf<typeof ThreadSubjectTypes>;

/**
 * GitHub's wire values for a submitted review's state. `PENDING` is absent:
 * a pending review is a draft and never reaches a conversation.
 */
export const ReviewVerdictStates = {
  COMMENTED: "COMMENTED",
  APPROVED: "APPROVED",
  CHANGES_REQUESTED: "CHANGES_REQUESTED",
  DISMISSED: "DISMISSED",
} as const;
export type ReviewVerdictState = ValueOf<typeof ReviewVerdictStates>;
