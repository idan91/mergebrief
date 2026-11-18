import clsx from "clsx";

import MergeBriefMark from "../icons/mergebrief-mark.svg?react";
import styles from "./GhostMark.module.scss";

export interface GhostMarkProps {
  className?: string | undefined;
}

/** The mark in Surface 3, leading an empty state with nothing in it yet. Decorative. */
export function GhostMark({ className }: GhostMarkProps) {
  return (
    <MergeBriefMark
      aria-hidden="true"
      className={clsx(styles["ghost"], className)}
      data-testid="ghost-mark"
      focusable="false"
    />
  );
}
