import type { ValueOf } from "types/utils";

/**
 * @description The **Compare** control. Canonical values match the marks artifact's `baselineLabel` for `previous-brief`;
 * `last-review` is the user-facing name for the `checkpoint` baseline.
 */
export const CompareParams = {
  PREVIOUS_BRIEF: "previous-brief",
  LAST_REVIEW: "last-review",
  OFF: "off",
} as const;
export type CompareParam = ValueOf<typeof CompareParams>;
