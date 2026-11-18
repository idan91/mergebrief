import type { ValueOf } from "types";

export const CommentAnchorKinds = {
  LINE: "line",
  FILE: "file",
} as const;

export type CommentAnchorKind = ValueOf<typeof CommentAnchorKinds>;

export interface DraftPolicy {
  readonly generate: boolean;
}
