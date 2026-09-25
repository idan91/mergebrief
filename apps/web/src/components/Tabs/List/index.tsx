import type { ReactNode } from "react";

import styles from "./List.module.scss";

export interface TabsListProps {
  label: string;
  children: ReactNode;
}

export function TabsList({ label, children }: TabsListProps) {
  return (
    <div aria-label={label} className={styles["list"]} role="tablist">
      {children}
    </div>
  );
}
