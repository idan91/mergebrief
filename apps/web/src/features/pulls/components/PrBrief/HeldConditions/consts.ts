import {
  HeldConditionsLayouts,
  HeldGroupHeadingLevels,
  type HeldConditionsLayout,
  type HeldGroupHeadingLevel,
} from "./types";

/** The panel's h1 owns the page; the popover's panel heading is an h2. */
export const GroupHeadingLevels: Record<
  HeldConditionsLayout,
  HeldGroupHeadingLevel
> = {
  [HeldConditionsLayouts.PANEL]: HeldGroupHeadingLevels.H2,
  [HeldConditionsLayouts.POPOVER]: HeldGroupHeadingLevels.H3,
};
