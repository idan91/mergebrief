import type { ValueOf } from "types/utils";

/** The ARIA pattern a list on the Dropdown internals announces as. */
export const DropdownRoles = {
  LISTBOX: "listbox",
  MENU: "menu",
} as const;
export type DropdownRole = ValueOf<typeof DropdownRoles>;

export interface DropdownSingleSelection {
  readonly multiple?: false | undefined;
  readonly value: string | undefined;
  readonly onValueChange: (value: string) => void;
}

export interface DropdownMultipleSelection {
  readonly multiple: true;
  readonly value: readonly string[];
  readonly onValueChange: (values: string[]) => void;
}

/** One value that closes on choice, or any number that keeps the panel open. */
export type DropdownSelection =
  | DropdownSingleSelection
  | DropdownMultipleSelection;
