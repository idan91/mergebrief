import type { ReactNode } from "react";

import { GhostMark } from "../GhostMark";
import { MarkLoader } from "../MarkLoader";
import { MarkLoaderSizes, MarkLoaderTones } from "../MarkLoader/types";
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
  /** The state is in motion: the brand's mark loader leads the block. */
  busy?: boolean;
  /** The ghost mark leads the block. Ignored while busy. */
  ghostMark?: boolean;
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
  ghostMark = false,
  children,
}: EmptyBlockProps) {
  let lead: ReactNode = null;
  if (busy) {
    lead = (
      <MarkLoader
        size={MarkLoaderSizes.LG}
        testId="empty-block-loader"
        tone={MarkLoaderTones.BRAND}
      />
    );
  } else if (ghostMark) {
    lead = <GhostMark />;
  }

  return (
    <div className={styles["block"]} data-testid="empty-block">
      {lead}
      {heading}
      {detail === undefined ? null : (
        <p className={styles["detail"]}>{detail}</p>
      )}
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
