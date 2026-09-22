import { useListItem } from "@floating-ui/react";
import type { ReactNode } from "react";

import { MenuItem } from "../../MenuItem/MenuItem";
import { MenuItemRoles } from "../../MenuItem/types";
import { useMenuContext } from "../context";
import CheckIcon from "../icons/check.svg?react";
import styles from "./MenuRow.module.scss";

export interface MenuRowProps {
  children: ReactNode;
  onSelect: () => void;
  /** A checked row states a choice: one of several as a radio, any number as a checkbox. */
  checked?: boolean;
  /** With `checked`, the row is a checkbox and the menu stays open on selection. */
  multiple?: boolean;
  /** A glyph before the label, such as a review mark beside its name. */
  glyph?: ReactNode;
  disabled?: boolean;
  /** A row whose work reports back into the menu, such as a sign out that can fail, leaves it open. */
  keepOpen?: boolean;
  className?: string | undefined;
  lang?: string | undefined;
}

/** One row of a `Menu`: a `MenuItem` the list navigation knows about. */
export function MenuRow({
  children,
  onSelect,
  checked,
  multiple = false,
  glyph,
  disabled = false,
  keepOpen = false,
  className,
  lang,
}: MenuRowProps) {
  const { ref, index } = useListItem();
  const menu = useMenuContext();
  const active = menu.activeIndex === index;
  const itemProps = menu.getItemProps({
    onClick() {
      onSelect();
      if (!multiple && !keepOpen) menu.close();
    },
  });
  const shared = {
    ...itemProps,
    className,
    disabled,
    lang,
    ref,
    tabIndex: active ? 0 : -1,
  };
  const content = (
    <span className={styles["content"]}>
      {checked === undefined ? null : (
        <span aria-hidden="true" className={styles["check"]}>
          {checked ? <CheckIcon /> : null}
        </span>
      )}
      {glyph === undefined ? null : (
        <span className={styles["glyph"]}>{glyph}</span>
      )}
      {children}
    </span>
  );

  if (checked === undefined) {
    return (
      <MenuItem {...shared} kind={MenuItemRoles.ITEM}>
        {content}
      </MenuItem>
    );
  }
  return (
    <MenuItem
      {...shared}
      checked={checked}
      kind={multiple ? MenuItemRoles.CHECKBOX : MenuItemRoles.RADIO}
    >
      {content}
    </MenuItem>
  );
}
