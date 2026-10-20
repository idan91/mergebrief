import type { ValueOf } from "types/utils";

export const MentionVariants = {
  /** The mention names the signed-in viewer. */
  VIEWER: "viewer",
} as const;
export type MentionVariant = ValueOf<typeof MentionVariants>;
