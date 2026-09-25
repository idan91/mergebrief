import type { ReactNode } from "react";

import styles from "./Label.module.scss";

export interface DropdownLabelProps {
  children: ReactNode;
}

/** A static line among the rows, such as who is signed in; never focusable. */
export function DropdownLabel({ children }: DropdownLabelProps) {
  return (
    <p className={styles["label"]} role="presentation">
      {children}
    </p>
  );
}
