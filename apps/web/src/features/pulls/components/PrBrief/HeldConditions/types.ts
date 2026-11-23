import type { ValueOf } from "types/utils";

/** Where the groups render: the page's panel, or the newer-commits popover inside a section. */
export const HeldConditionsLayouts = {
  PANEL: "panel",
  POPOVER: "popover",
} as const;
export type HeldConditionsLayout = ValueOf<typeof HeldConditionsLayouts>;

/** A group title's level under its container's heading. */
export const HeldGroupHeadingLevels = {
  H2: "h2",
  H3: "h3",
} as const;
export type HeldGroupHeadingLevel = ValueOf<typeof HeldGroupHeadingLevels>;
