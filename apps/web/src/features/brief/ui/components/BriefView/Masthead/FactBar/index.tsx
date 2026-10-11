import type { ReactNode } from "react";

import styles from "./FactBar.module.scss";

export interface FactBarProps {
  title: string;
  /** What sits beside the title on the head line. */
  aside: ReactNode;
  /** A line under the head. */
  children?: ReactNode;
  testId: string;
}

/** A bar that states facts instead of disclosing a panel: the collapsible bar's chrome, no toggle. */
export function FactBar({ title, aside, children, testId }: FactBarProps) {
  return (
    <section className={styles["bar"]} data-testid={testId}>
      <div className={styles["head"]}>
        <h2 className={styles["title"]}>{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}
