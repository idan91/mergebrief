import { FloatingList } from "@floating-ui/react";
import clsx from "clsx";
import type { ReactNode } from "react";

import { PopoverContent } from "../../Popover/Content";
import { useDropdownContext } from "../context";
import { DropdownSheet } from "../Sheet";
import styles from "./Content.module.scss";

export interface DropdownPanelProps {
  /** A listbox's accessible name. A menu is named by its trigger, so its callers pass none. */
  label?: string | undefined;
  className?: string | undefined;
  sheet?: false | undefined;
  children: ReactNode;
}

export interface DropdownSheetContentProps {
  /** Names the sheet and its listbox. */
  label: string;
  className?: string | undefined;
  /** Rises on a BottomSheet, for a list too long to float on a phone. */
  sheet: true;
  children: ReactNode;
}

export type DropdownContentProps =
  | DropdownPanelProps
  | DropdownSheetContentProps;

/** The panel: Popover's, wearing the list chrome, its rows registered for navigation. */
export function DropdownContent({
  label,
  className,
  sheet,
  children,
}: DropdownContentProps) {
  const dropdown = useDropdownContext();
  const rows = (
    <FloatingList
      elementsRef={dropdown.elementsRef}
      labelsRef={dropdown.labelsRef}
    >
      {children}
    </FloatingList>
  );

  if (sheet) {
    return (
      <DropdownSheet className={className} label={label}>
        {rows}
      </DropdownSheet>
    );
  }
  return (
    <PopoverContent className={clsx(styles["panel"], className)} label={label}>
      {rows}
    </PopoverContent>
  );
}
