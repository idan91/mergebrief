import type { ValueOf } from "types/utils";

export const BarHeadingLevels = {
  H2: "h2",
  H3: "h3",
} as const;
export type BarHeadingLevel = ValueOf<typeof BarHeadingLevels>;
