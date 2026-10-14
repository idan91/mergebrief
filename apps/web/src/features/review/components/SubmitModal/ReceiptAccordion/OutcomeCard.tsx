import type { ReviewOutcome } from "types/reviews";
import { useTranslation } from "react-i18next";

import type { Receipt } from "../../../utils/receipt";
import { reviewOutcomeLabel, summarySignatureLine } from "../../../utils/state";
import styles from "./ReceiptAccordion.module.scss";

export interface OutcomeCardProps {
  receipt: Receipt;
  outcome: ReviewOutcome | undefined;
}

export function OutcomeCard({ receipt, outcome }: OutcomeCardProps) {
  const { t } = useTranslation();
  return (
    <section className={styles["card"]}>
      {outcome === undefined ? null : (
        <div className={styles["outcomeRow"]}>
          <span>{t("review.summary.outcomeLabel")}</span>
          <span className={styles["outcomeValue"]}>
            {reviewOutcomeLabel(t, outcome)}
          </span>
        </div>
      )}
      <div className={styles["signature"]}>
        {summarySignatureLine(t, {
          reviewedChunks: receipt.progress.reviewedChunks,
          addressedRisks: receipt.counts.addressed,
          dismissedRisks: receipt.counts.dismissed,
        })}
      </div>
    </section>
  );
}
