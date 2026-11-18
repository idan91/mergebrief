import type { ValueOf } from "types/utils";

/** How a tablist sits: a row over its panel, or a side rail beside it. */
export const TabsVariants = {
  UNDERLINE: "underline",
  RAIL: "rail",
} as const;
export type TabsVariant = ValueOf<typeof TabsVariants>;
