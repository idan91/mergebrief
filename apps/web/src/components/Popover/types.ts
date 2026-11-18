import type { ValueOf } from "types/utils";

export const PopoverFocusTargets = {
  /** A disclosure: focus stays on the trigger and Tab is the way in. */
  TRIGGER: "trigger",
  /** A panel with controls: the first tabbable one takes focus. */
  CONTENT: "content",
  /** A navigable list: its own navigation focuses the row, the manager stays out. */
  LIST: "list",
} as const;
export type PopoverFocusTarget = ValueOf<typeof PopoverFocusTargets>;
