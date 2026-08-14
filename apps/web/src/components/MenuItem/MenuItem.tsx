import type { ComponentPropsWithRef, MouseEvent } from "react";
import type { ValueOf } from "types";
import clsx from "clsx";

import styles from "./MenuItem.module.scss";

export const MENU_ITEM_ROLES = {
  ITEM: "menuitem",
  RADIO: "menuitemradio",
  CHECKBOX: "menuitemcheckbox",
} as const;
export type MenuItemRole = ValueOf<typeof MENU_ITEM_ROLES>;

export type MenuItemBaseProps = {
  /** aria-disabled + interaction guard — never the native attribute. */
  disabled?: boolean;
};

type MenuItemButtonAttributes = Omit<
  ComponentPropsWithRef<"button">,
  "disabled" | "role" | "aria-checked"
>;

/* The discriminant is `kind`, not a `role` prop: jsx-a11y reads a literal
   `role` on the call site and demands aria-checked there, which the
   component owns. */
export type MenuItemAsItemProps = {
  kind?: typeof MENU_ITEM_ROLES.ITEM;
} & MenuItemBaseProps &
  MenuItemButtonAttributes;

export type MenuItemAsRadioProps = {
  kind: typeof MENU_ITEM_ROLES.RADIO;
  checked: boolean;
} & MenuItemBaseProps &
  MenuItemButtonAttributes;

export type MenuItemAsCheckboxProps = {
  kind: typeof MENU_ITEM_ROLES.CHECKBOX;
  checked: boolean;
} & MenuItemBaseProps &
  MenuItemButtonAttributes;

export type MenuItemProps =
  | MenuItemAsItemProps
  | MenuItemAsRadioProps
  | MenuItemAsCheckboxProps;

type ResolvedMenuItem = {
  role: MenuItemRole;
  checked: boolean | undefined;
  rest: MenuItemBaseProps & MenuItemButtonAttributes;
};

function resolveProps(props: MenuItemProps): ResolvedMenuItem {
  if (
    props.kind === MENU_ITEM_ROLES.RADIO ||
    props.kind === MENU_ITEM_ROLES.CHECKBOX
  ) {
    const { kind, checked, ...rest } = props;
    return { role: kind, checked, rest };
  }
  const { kind = MENU_ITEM_ROLES.ITEM, ...rest } = props;
  return { role: kind, checked: undefined, rest };
}

/**
 * One item inside a `role=menu`. Roving `tabIndex` is the parent menu's
 * cross-item state and rides rest-spread; radio/checkbox roles require
 * `checked` → `aria-checked`.
 */
export function MenuItem(props: MenuItemProps) {
  const { role, checked, rest } = resolveProps(props);
  const {
    disabled = false,
    "aria-disabled": ariaDisabled,
    className,
    onClick,
    ...attributes
  } = rest;
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (disabled) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  };
  return (
    <button
      {...attributes}
      aria-checked={checked}
      aria-disabled={disabled ? true : ariaDisabled}
      className={clsx(styles["menuItem"], className)}
      role={role}
      type="button"
      onClick={handleClick}
    />
  );
}
