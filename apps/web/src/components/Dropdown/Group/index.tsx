import { useId, type ReactNode } from "react";

import styles from "./Group.module.scss";

export interface DropdownGroupProps {
  label: string;
  children: ReactNode;
}

/** A named run of rows; a rule separates one group from the next. */
export function DropdownGroup({ label, children }: DropdownGroupProps) {
  const labelId = useId();

  return (
    <div aria-labelledby={labelId} className={styles["group"]} role="group">
      <span className={styles["groupLabel"]} id={labelId}>
        {label}
      </span>
      {children}
    </div>
  );
}
