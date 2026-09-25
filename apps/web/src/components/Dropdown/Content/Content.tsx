import { FloatingList } from "@floating-ui/react";
import clsx from "clsx";
import type { ReactNode } from "react";

import { PopoverContent } from "../../Popover/Content/Content";
import { useDropdownContext } from "../context";
import styles from "./Content.module.scss";

export interface DropdownContentProps {
  /** A listbox's accessible name. A menu is named by its trigger, so its callers pass none. */
  label?: string | undefined;
  className?: string | undefined;
  children: ReactNode;
}

/** The panel: Popover's, wearing the list chrome, its rows registered for navigation. */
export function DropdownContent({
  label,
  className,
  children,
}: DropdownContentProps) {
  const dropdown = useDropdownContext();

  return (
    <PopoverContent className={clsx(styles["panel"], className)} label={label}>
      <FloatingList
        elementsRef={dropdown.elementsRef}
        labelsRef={dropdown.labelsRef}
      >
        {children}
      </FloatingList>
    </PopoverContent>
  );
}
