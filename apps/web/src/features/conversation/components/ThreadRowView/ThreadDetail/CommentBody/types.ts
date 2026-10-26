import type { ValueOf } from "types/utils";

export const CommentBodyStates = {
  WHOLE: "whole",
  CLAMPED: "clamped",
  EXPANDED: "expanded",
} as const;

export type CommentBodyState = ValueOf<typeof CommentBodyStates>;
