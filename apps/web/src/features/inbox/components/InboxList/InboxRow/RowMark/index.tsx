import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { InboxReviewState } from "types/inbox";

import { Callout } from "@web/components/Callout";
import { useCalloutHover } from "@web/components/Callout/useCalloutHover";
import { Icon } from "@web/components/Icon";
import { IconNames, IconSizes } from "@web/components/Icon/types";
import { ReviewMarkLabelKeys } from "@web/components/ReviewMark/consts";
import { ReviewMark } from "@web/components/ReviewMark";
import { UnknownValues, type UnknownValue } from "@web/utils/open-enum/types";
import styles from "./RowMark.module.scss";

export interface RowMarkProps {
  /** Absent for the viewer's own pull request. */
  reviewState: InboxReviewState | UnknownValue | undefined;
}

/**
 * The review mark at row size; the viewer's own rows carry the person icon
 * instead. The mark itself is hidden from assistive technology, since
 * the row link names the state in words; a pointer that rests on it gets
 * the same words as a callout.
 */
export function RowMark({ reviewState }: RowMarkProps) {
  const { t } = useTranslation();
  const [anchor, setAnchor] = useState<HTMLSpanElement | null>(null);
  const hover = useCalloutHover();
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

  const label =
    reviewState === undefined
      ? t("shell.marks.yoursTip")
      : t(ReviewMarkLabelKeys[reviewState]);

  return (
    <>
      <span
        aria-hidden="true"
        className={styles["mark"]}
        data-review={reviewState ?? "yours"}
        data-testid="inbox-row-mark"
        onPointerEnter={hover.arm}
        onPointerLeave={hover.disarm}
        ref={setAnchor}
      >
        {reviewState === undefined ? (
          <Icon name={IconNames.USER} />
        ) : (
          <ReviewMark size={IconSizes.LG} state={reviewState} />
        )}
      </span>
      {hover.open && anchor !== null ? (
        <Callout anchor={anchor} compact fit onClose={hover.close}>
          <Callout.Title>{label}</Callout.Title>
        </Callout>
      ) : null}
    </>
  );
}
