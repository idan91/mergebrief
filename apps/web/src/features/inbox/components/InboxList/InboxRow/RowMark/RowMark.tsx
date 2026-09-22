import { useTranslation } from "react-i18next";
import { InboxReviewStates, type InboxReviewState } from "types/inbox";

import PersonIcon from "@web/components/icons/person.svg?react";
import { ScreenReaderOnly } from "@web/components/ScreenReaderOnly/ScreenReaderOnly";
import InProgressMark from "../../../marks/in-progress.svg?react";
import NewMark from "../../../marks/new.svg?react";
import ReviewedMark from "../../../marks/reviewed.svg?react";
import UpdatedMark from "../../../marks/updated.svg?react";
import styles from "./RowMark.module.scss";

export interface RowMarkProps {
  /** Null for the viewer's own pull request. */
  reviewState: InboxReviewState | null;
}

/** The review mark on the 14px grid; the viewer's own rows carry the person icon instead. */
export function RowMark({ reviewState }: RowMarkProps) {
  const { t } = useTranslation();

  if (reviewState === null) {
    return (
      <span className={styles["mark"]} data-review="yours">
        <PersonIcon aria-hidden="true" />
        <ScreenReaderOnly>{t("home.marks.yours")}</ScreenReaderOnly>
      </span>
    );
  }

  const glyphs = {
    [InboxReviewStates.NEW]: <NewMark aria-hidden="true" />,
    [InboxReviewStates.IN_PROGRESS]: <InProgressMark aria-hidden="true" />,
    [InboxReviewStates.REVIEWED]: <ReviewedMark aria-hidden="true" />,
    [InboxReviewStates.UPDATED]: <UpdatedMark aria-hidden="true" />,
  };
  const labels = {
    [InboxReviewStates.NEW]: t("home.marks.new"),
    [InboxReviewStates.IN_PROGRESS]: t("home.marks.inProgress"),
    [InboxReviewStates.REVIEWED]: t("home.marks.reviewed"),
    [InboxReviewStates.UPDATED]: t("home.marks.updated"),
  };

  return (
    <span className={styles["mark"]} data-review={reviewState}>
      {glyphs[reviewState]}
      <ScreenReaderOnly>{labels[reviewState]}</ScreenReaderOnly>
    </span>
  );
}
