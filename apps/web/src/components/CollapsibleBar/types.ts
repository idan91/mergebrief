import type { ValueOf } from "types/utils";

export const BarHeadingLevels = {
  H2: "h2",
  H3: "h3",
} as const;
export type BarHeadingLevel = ValueOf<typeof BarHeadingLevels>;

/** A boxed panel, or a quiet row under a hairline that attaches to the text above it. */
export const BarVariants = {
  PANEL: "panel",
  ROW: "row",
} as const;
export type BarVariant = ValueOf<typeof BarVariants>;
