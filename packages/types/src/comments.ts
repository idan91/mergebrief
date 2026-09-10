import type { ValueOf } from "./utils";

export const CommentAnchorKinds = {
  LINE: "line",
  FILE: "file",
} as const;

export type CommentAnchorKind = ValueOf<typeof CommentAnchorKinds>;
