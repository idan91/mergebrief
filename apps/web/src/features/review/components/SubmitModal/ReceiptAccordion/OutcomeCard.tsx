import type { ReviewOutcome } from "types/reviews";
import { useTranslation } from "react-i18next";

import { reviewOutcomeLabel } from "../../../utils/state";
import styles from "./ReceiptAccordion.module.scss";

export interface OutcomeCardProps {
  outcome: ReviewOutcome | undefined;
  /** The posted signature line, shown verbatim; absent when nothing posts. */
  signatureLine?: string | undefined;
}

export function OutcomeCard({ outcome, signatureLine }: OutcomeCardProps) {
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
      {signatureLine === undefined ? null : (
        <div className={styles["signature"]}>{signatureLine}</div>
      )}
    </section>
  );
}
