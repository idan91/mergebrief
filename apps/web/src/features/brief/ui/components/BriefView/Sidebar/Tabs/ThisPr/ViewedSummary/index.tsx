import { useTranslation } from "react-i18next";

import { useReviewSession } from "@web/features/review/session";

import type { GroupView } from "../../../../../../../model/utils/view-model";
import styles from "./ViewedSummary.module.scss";

export interface ViewedSummaryProps {
  groups: readonly GroupView[];
}

/** The Sidebar sheet's one line of progress: viewed chunks over all of them. */
export function ViewedSummary({ groups }: ViewedSummaryProps) {
  const { t } = useTranslation();
  const reviewedChunks = useReviewSession((state) => state.reviewedChunks);
  const chunks = groups.flatMap((group) => group.chunks);
  const viewed = chunks.filter((chunk) => reviewedChunks.has(chunk.id)).length;

  return (
    <p className={styles["summary"]}>
      {t("brief.mobile.viewedSummary", { viewed, total: chunks.length })}
    </p>
  );
}
