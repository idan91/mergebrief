import { useListItem } from "@floating-ui/react";
import clsx from "clsx";
import { useId, useLayoutEffect, type ReactNode } from "react";

import { useDropdownContext } from "../../Dropdown/context";
import itemStyles from "../../Dropdown/Item/Item.module.scss";
import { Icon } from "../../Icon";
import { IconNames, IconSizes } from "../../Icon/types";
import styles from "./Item.module.scss";

export interface MenuItemProps {
  children: ReactNode;
  onSelect: () => void;
  /** A row that states a choice, one of several: a radio row, and the menu stays open. */
  checked?: boolean;
  /** With `checked`, the row turns one setting on or off instead: a checkbox row. */
  toggles?: boolean;
  /** A mark before the label. */
  glyph?: ReactNode;
  disabled?: boolean;
  /** Set while the action waits: the row refuses and shows this under its label as its description. */
  unavailableReason?: string | undefined;
  /** A destructive action, in the negative ink. */
  danger?: boolean;
  className?: string | undefined;
  lang?: string | undefined;
}

function readItemRole(
  stating: boolean,
  toggles: boolean,
): "menuitem" | "menuitemradio" | "menuitemcheckbox" {
  if (!stating) {
    return "menuitem";
  }
  if (toggles) {
    return "menuitemcheckbox";
  }
  return "menuitemradio";
}

/** One action row: `menuitem`, or `menuitemradio` when it carries `checked`, `menuitemcheckbox` when it also `toggles`. */
export function MenuItem({
  children,
  onSelect,
  checked,
  toggles = false,
  glyph,
  disabled = false,
  unavailableReason,
  danger = false,
  className,
  lang,
}: MenuItemProps) {
  const { ref, index } = useListItem();
  const menu = useDropdownContext();
  const active = menu.activeIndex === index;
  const stating = checked !== undefined;
  const { markSelected } = menu;
  const reasonId = useId();
  const unavailable = unavailableReason !== undefined;
  const refused = disabled || unavailable;

  useLayoutEffect(() => {
    markSelected(index, checked === true);
    return () => markSelected(index, false);
  }, [markSelected, index, checked]);

  // floating-ui reads a row's label once, on mount; a relabel while open
  // (a language switch) would leave typeahead matching the old text.
  useLayoutEffect(() => {
    const row = menu.elementsRef.current[index];
    if (row !== undefined && row !== null) {
      menu.labelsRef.current[index] = row.textContent;
    }
  });

  const itemProps = menu.getItemProps({
    onClick() {
      if (refused) {
        return;
      }
      onSelect();
      if (!stating) {
        menu.close();
      }
    },
  });
  const role = readItemRole(stating, toggles);
  const label = (
    <span className={clsx(itemStyles["label"], styles["label"])}>
      {children}
    </span>
  );

  return (
    <button
      {...itemProps}
      aria-checked={checked}
      aria-describedby={unavailable ? reasonId : undefined}
      aria-disabled={refused ? true : undefined}
      className={clsx(itemStyles["item"], styles["item"], className)}
      data-state={unavailable ? "unavailable" : undefined}
      data-variant={danger ? "danger" : undefined}
      lang={lang}
      ref={ref}
      role={role}
      tabIndex={active ? 0 : -1}
      type="button"
    >
      {stating ? (
        <span aria-hidden="true" className={itemStyles["check"]}>
          {checked ? <Icon name={IconNames.CHECK} size={IconSizes.MD} /> : null}
        </span>
      ) : null}
      {glyph === undefined ? null : (
        <span className={clsx(itemStyles["glyph"], styles["glyph"])}>
          {glyph}
        </span>
      )}
      {unavailable ? (
        <span className={styles["text"]}>
          {label}
          <span aria-hidden="true" className={styles["reason"]} id={reasonId}>
            {unavailableReason}
          </span>
        </span>
      ) : (
        label
      )}
    </button>
  );
}
