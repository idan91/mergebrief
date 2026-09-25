import { useListItem } from "@floating-ui/react";
import clsx from "clsx";
import { useLayoutEffect, type ReactNode } from "react";

import { Icon } from "../../Icon/Icon";
import { IconNames, IconSizes } from "../../Icon/types";
import { useDropdownContext } from "../context";
import { chooseValue, isValueSelected } from "../utils";
import styles from "./Item.module.scss";

export interface DropdownItemProps {
  value: string;
  children: ReactNode;
  /** A mark before the label, such as a review mark beside its name. */
  glyph?: ReactNode;
  disabled?: boolean;
  className?: string | undefined;
  lang?: string | undefined;
}

/** One option: ticked while chosen, focusable through the list's roving tabIndex. */
export function DropdownItem({
  value,
  children,
  glyph,
  disabled = false,
  className,
  lang,
}: DropdownItemProps) {
  const { ref, index } = useListItem();
  const dropdown = useDropdownContext();
  const selection = dropdown.selection;
  const selected =
    selection === undefined ? false : isValueSelected(selection, value);
  const active = dropdown.activeIndex === index;
  const { markSelected } = dropdown;

  useLayoutEffect(() => {
    markSelected(index, selected);
    return () => markSelected(index, false);
  }, [markSelected, index, selected]);

  // floating-ui reads a row's label once, on mount; a relabel while open
  // (a language switch) would leave typeahead matching the old text.
  useLayoutEffect(() => {
    const row = dropdown.elementsRef.current[index];
    if (row !== undefined && row !== null) {
      dropdown.labelsRef.current[index] = row.textContent;
    }
  });

  const itemProps = dropdown.getItemProps({
    onClick() {
      if (disabled || selection === undefined) {
        return;
      }
      chooseValue(selection, value);
      if (!selection.multiple) {
        dropdown.close();
      }
    },
  });

  return (
    <button
      {...itemProps}
      aria-disabled={disabled ? true : undefined}
      aria-selected={selected}
      className={clsx(styles["item"], className)}
      lang={lang}
      ref={ref}
      role="option"
      tabIndex={active ? 0 : -1}
      type="button"
    >
      <span aria-hidden="true" className={styles["check"]}>
        {selected ? <Icon name={IconNames.CHECK} size={IconSizes.MD} /> : null}
      </span>
      {glyph === undefined ? null : (
        <span className={styles["glyph"]}>{glyph}</span>
      )}
      <span className={styles["label"]}>{children}</span>
    </button>
  );
}
