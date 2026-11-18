import type { ValueOf } from "types/utils";

export const MarkLoaderTones = {
  /** The brand moment: the PR page's generating card. */
  BRAND: "brand",
  /** Text 2, for a loader inside a row or a chip. */
  MUTED: "muted",
} as const;
export type MarkLoaderTone = ValueOf<typeof MarkLoaderTones>;

export const MarkLoaderSizes = {
  /** 14px, beside a line of small text. */
  SM: "sm",
  /** 28px, leading a block. */
  LG: "lg",
} as const;
export type MarkLoaderSize = ValueOf<typeof MarkLoaderSizes>;
