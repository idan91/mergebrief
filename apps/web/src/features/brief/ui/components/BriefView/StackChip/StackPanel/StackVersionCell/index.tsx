import type { ReactNode } from "react";

import styles from "./StackVersionCell.module.scss";

export interface StackVersionCellProps {
  /** The version the toggle shows; the other keeps its space but hides. */
  active: boolean;
  children: ReactNode;
}

/** One stack version in the panel's shared cell, so switching never moves the bar. */
export function StackVersionCell({ active, children }: StackVersionCellProps) {
  const hidden = !active;

  return (
    <span
      aria-hidden={hidden || undefined}
      className={styles["cell"]}
      data-state={hidden ? "inactive" : undefined}
      inert={hidden}
    >
      {children}
    </span>
  );
}
