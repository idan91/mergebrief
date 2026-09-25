import { useListItem } from "@floating-ui/react";
import clsx from "clsx";
import { useLayoutEffect, type ReactNode } from "react";

import { useDropdownContext } from "../../Dropdown/context";
import itemStyles from "../../Dropdown/Item/Item.module.scss";
import { Icon } from "../../Icon/Icon";
import { IconNames, IconSizes } from "../../Icon/types";
import styles from "./Item.module.scss";

export interface MenuItemProps {
  children: ReactNode;
  onSelect: () => void;
  /** A row that states a choice, one of several: a radio row, and the menu stays open. */
  checked?: boolean;
  /** A mark before the label. */
  glyph?: ReactNode;
  disabled?: boolean;
  /** A destructive action, in the negative ink. */
  danger?: boolean;
  className?: string | undefined;
  lang?: string | undefined;
}

/** One action row: `menuitem`, or `menuitemradio` when it carries `checked`. */
export function MenuItem({
  children,
  onSelect,
  checked,
  glyph,
  disabled = false,
  danger = false,
  className,
  lang,
}: MenuItemProps) {
  const { ref, index } = useListItem();
  const menu = useDropdownContext();
  const active = menu.activeIndex === index;
  const stating = checked !== undefined;
  const { markSelected } = menu;

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
      if (disabled) {
        return;
      }
      onSelect();
      if (!stating) {
        menu.close();
      }
    },
  });
  const role = stating ? "menuitemradio" : "menuitem";

  return (
    <button
      {...itemProps}
      aria-checked={checked}
      aria-disabled={disabled ? true : undefined}
      className={clsx(itemStyles["item"], styles["item"], className)}
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
      <span className={itemStyles["label"]}>{children}</span>
    </button>
  );
}
