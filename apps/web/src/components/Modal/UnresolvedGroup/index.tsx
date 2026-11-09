import { useId, type ReactNode } from "react";

import styles from "./UnresolvedGroup.module.scss";

export interface UnresolvedGroupProps {
  /** The kind's name, already plural-aware for `count`. */
  heading: string;
  count: number;
  /** `Modal.UnresolvedRow`s. */
  children: ReactNode;
}

/** One kind in a gate dialog's unresolved list: its heading, then its rows. */
export function UnresolvedGroup({
  heading,
  count,
  children,
}: UnresolvedGroupProps) {
  const headingId = useId();

  return (
    <div>
      <h3 className={styles["heading"]} id={headingId}>
        {heading} <span className={styles["count"]}>{count}</span>
      </h3>
      <ul aria-labelledby={headingId} className={styles["rows"]}>
        {children}
      </ul>
    </div>
  );
}
