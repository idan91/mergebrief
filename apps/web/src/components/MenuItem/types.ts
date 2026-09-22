import type { ValueOf } from "types/utils";

export const MenuItemRoles = {
  ITEM: "menuitem",
  RADIO: "menuitemradio",
  CHECKBOX: "menuitemcheckbox",
} as const;
export type MenuItemRole = ValueOf<typeof MenuItemRoles>;
