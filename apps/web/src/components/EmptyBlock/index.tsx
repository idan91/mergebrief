import type { ReactNode } from "react";

import styles from "./EmptyBlock.module.scss";

export interface EmptyBlockProps {
  /** The heading element at the level the screen's structure gives it. */
  heading: ReactNode;
  detail?: string | undefined;
  /** A quieter second line under the detail: a count, a time, a caveat. */
  note?: string | undefined;
  /** The note changes while the block is shown: a polite live region, read whole, no focus move. */
  noteLive?: boolean;
  action?: ReactNode;
  /** The state is in motion: a spinner leads the detail line. */
  busy?: boolean;
  /** What renders under the block at the region's full width: a preview. */
  children?: ReactNode;
}

/** A quiet block where content would be: what is missing, why, and one way on. */
export function EmptyBlock({
  heading,
  detail,
  note,
  noteLive = false,
  action,
  busy = false,
  children,
}: EmptyBlockProps) {
  const showsDetailLine = detail !== undefined || busy;

  return (
    <div className={styles["block"]} data-testid="empty-block">
      {heading}
      {showsDetailLine ? (
        <p className={styles["detail"]}>
          {busy ? (
            <span
              aria-hidden="true"
              className={styles["spinner"]}
              data-testid="empty-block-spinner"
            />
          ) : null}
          {detail}
        </p>
      ) : null}
      {note === undefined ? null : (
        <p
          aria-atomic={noteLive ? "true" : undefined}
          aria-live={noteLive ? "polite" : undefined}
          className={styles["note"]}
        >
          {note}
        </p>
      )}
      {action}
      {children === undefined ? null : (
        <div className={styles["below"]}>{children}</div>
      )}
    </div>
  );
}
