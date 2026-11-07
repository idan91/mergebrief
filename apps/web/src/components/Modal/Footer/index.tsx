import type { ReactNode } from "react";

import styles from "./Footer.module.scss";

export interface ModalFooterProps {
  /** Why an action is off, or how the last one went; reads before the actions. */
  reason?: ReactNode;
  /** The actions: secondary first, the primary last. */
  children: ReactNode;
}

/** A dialog's one footer: any reason, directly above the action row. */
export function ModalFooter({ reason, children }: ModalFooterProps) {
  return (
    <div className={styles["footer"]}>
      {reason}
      <div className={styles["actions"]}>{children}</div>
    </div>
  );
}
