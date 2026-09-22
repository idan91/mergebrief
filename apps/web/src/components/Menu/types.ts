import type { ValueOf } from "types/utils";

export const MenuTriggerKinds = {
  /** A 32px icon button; `label` is its accessible name. */
  ICON: "icon",
  /** A text control whose own content names it, such as a filter. */
  TEXT: "text",
} as const;
export type MenuTriggerKind = ValueOf<typeof MenuTriggerKinds>;
