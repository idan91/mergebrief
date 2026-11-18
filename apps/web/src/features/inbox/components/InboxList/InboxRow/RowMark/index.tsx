import type { InboxReviewState } from "types/inbox";

import { Icon } from "@web/components/Icon";
import { IconNames, IconSizes } from "@web/components/Icon/types";
import { ReviewMark } from "@web/components/ReviewMark";
import { UnknownValues, type UnknownValue } from "@web/utils/open-enum/types";
import styles from "./RowMark.module.scss";

export interface RowMarkProps {
  /** Absent for the viewer's own pull request. */
  reviewState: InboxReviewState | UnknownValue | undefined;
}

/**
 * The review mark at row size; the viewer's own rows carry the person icon
 * instead. Hidden from assistive technology, since the row link names the
 * state in words; the lead slot over it names the state to a pointer.
 */
export function RowMark({ reviewState }: RowMarkProps) {
  if (reviewState === UnknownValues.UNKNOWN) {
    return (
      <span
        aria-hidden="true"
        className={styles["mark"]}
        data-review={UnknownValues.UNKNOWN}
        data-testid="inbox-row-mark"
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={styles["mark"]}
      data-review={reviewState ?? "yours"}
      data-testid="inbox-row-mark"
    >
      {reviewState === undefined ? (
        <Icon name={IconNames.USER} />
      ) : (
        <ReviewMark size={IconSizes.LG} state={reviewState} />
      )}
    </span>
  );
}
