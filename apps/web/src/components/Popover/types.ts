import type { ValueOf } from "types/utils";

export const PopoverFocusTargets = {
  /** A disclosure: focus stays on the trigger and Tab is the way in. */
  TRIGGER: "trigger",
  /** A list: the first tabbable row takes focus. */
  CONTENT: "content",
} as const;
export type PopoverFocusTarget = ValueOf<typeof PopoverFocusTargets>;
