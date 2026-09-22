import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { InboxReviewState } from "types/inbox";

import { Callout } from "@web/components/Callout/Callout";
import { useCalloutHover } from "@web/components/Callout/useCalloutHover";
import PersonIcon from "@web/components/icons/person.svg?react";
import {
  ReviewMarkGlyphs,
  ReviewMarkLabelKeys,
} from "@web/components/marks/consts";
import styles from "./RowMark.module.scss";

export interface RowMarkProps {
  /** Null for the viewer's own pull request. */
  reviewState: InboxReviewState | null;
}

/**
 * The review mark on the 14px grid; the viewer's own rows carry the person
 * icon instead. The mark itself is hidden from assistive technology, since
 * the row link names the state in words; a pointer that rests on it gets
 * the same words as a callout.
 */
export function RowMark({ reviewState }: RowMarkProps) {
  const { t } = useTranslation();
  const [anchor, setAnchor] = useState<HTMLSpanElement | null>(null);
  const hover = useCalloutHover();
  const label =
    reviewState === null
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
        {reviewState === null ? <PersonIcon /> : ReviewMarkGlyphs[reviewState]}
      </span>
      {hover.open && anchor !== null ? (
        <Callout anchor={anchor} compact fit onClose={hover.close}>
          <Callout.Title>{label}</Callout.Title>
        </Callout>
      ) : null}
    </>
  );
}
