import type { ReactNode } from "react";

import styles from "./EmptyBlock.module.scss";

export interface EmptyBlockProps {
  /** The heading element at the level the screen's structure gives it. */
  heading: ReactNode;
  detail?: string | undefined;
  action?: ReactNode;
}

/** A quiet block where a list would be: what is missing, why, and one way on. */
export function EmptyBlock({ heading, detail, action }: EmptyBlockProps) {
  return (
    <div className={styles["block"]} data-testid="empty-block">
      {heading}
      {detail === undefined ? null : (
        <p className={styles["detail"]}>{detail}</p>
      )}
      {action}
    </div>
  );
}
