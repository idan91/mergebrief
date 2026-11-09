import type { ValueOf } from "types/utils";

export const ToolbarButtonVariants = {
  BOXED: "boxed",
  GHOST: "ghost",
} as const;
export type ToolbarButtonVariant = ValueOf<typeof ToolbarButtonVariants>;
