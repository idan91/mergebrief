import type { ReviewOutcome } from "types/reviews";
import { useTranslation } from "react-i18next";

import { reviewOutcomeLabel } from "../../../../utils/state";
import type { Receipt } from "../../../../utils/receipt";
import styles from "./ReceiptRows.module.scss";

export interface ReceiptRowsProps {
  receipt: Receipt;
  outcome: ReviewOutcome | undefined;
}

/** What the receipt comes to, as plain rows: the outcome, chunks read, flags open, comments. */
export function ReceiptRows({ receipt, outcome }: ReceiptRowsProps) {
  const { t } = useTranslation();

  return (
    <dl className={styles["rows"]}>
      {outcome === undefined ? null : (
        <div className={styles["row"]}>
          <dt>{t("review.summary.outcomeLabel")}</dt>
          <dd>{reviewOutcomeLabel(t, outcome)}</dd>
        </div>
      )}
      <div className={styles["row"]}>
        <dt>{t("brief.mobile.chunksRead")}</dt>
        <dd>
          {receipt.progress.reviewedChunks}/{receipt.progress.chunkTotal}
        </dd>
      </div>
      <div className={styles["row"]}>
        <dt>{t("brief.mobile.flagsOpen")}</dt>
        <dd>{receipt.counts.open}</dd>
      </div>
      <div className={styles["row"]}>
        <dt>{t("review.summary.inlineComments")}</dt>
        <dd>{receipt.comments.length}</dd>
      </div>
    </dl>
  );
}
