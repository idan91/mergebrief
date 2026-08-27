import type { ComponentPropsWithRef, MouseEvent } from "react";
import type { ValueOf } from "types";
import clsx from "clsx";

import styles from "./MenuItem.module.scss";

export const MenuItemRoles = {
  ITEM: "menuitem",
  RADIO: "menuitemradio",
  CHECKBOX: "menuitemcheckbox",
} as const;
export type MenuItemRole = ValueOf<typeof MenuItemRoles>;

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
  kind?: typeof MenuItemRoles.ITEM;
} & MenuItemBaseProps &
  MenuItemButtonAttributes;

export type MenuItemAsRadioProps = {
  kind: typeof MenuItemRoles.RADIO;
  checked: boolean;
} & MenuItemBaseProps &
  MenuItemButtonAttributes;

export type MenuItemAsCheckboxProps = {
  kind: typeof MenuItemRoles.CHECKBOX;
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
    props.kind === MenuItemRoles.RADIO ||
    props.kind === MenuItemRoles.CHECKBOX
  ) {
    const { kind, checked, ...rest } = props;
    return { role: kind, checked, rest };
  }
  const { kind = MenuItemRoles.ITEM, ...rest } = props;
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
