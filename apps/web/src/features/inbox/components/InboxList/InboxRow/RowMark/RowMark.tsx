import type { InboxReviewState } from "types/inbox";

import PersonIcon from "@web/components/icons/person.svg?react";
import { ReviewMarkGlyphs } from "@web/components/marks/consts";
import styles from "./RowMark.module.scss";

export interface RowMarkProps {
  /** Null for the viewer's own pull request. */
  reviewState: InboxReviewState | null;
}

/**
 * The review mark on the 14px grid; the viewer's own rows carry the person
 * icon instead. Hidden from assistive technology: the row link names the
 * state in words.
 */
export function RowMark({ reviewState }: RowMarkProps) {
  if (reviewState === null) {
    return (
      <span aria-hidden="true" className={styles["mark"]} data-review="yours">
        <PersonIcon />
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className={styles["mark"]}
      data-review={reviewState}
    >
      {ReviewMarkGlyphs[reviewState]}
    </span>
  );
}
