import type { ReviewOutcome } from "types/reviews";
import { useTranslation } from "react-i18next";

import { Chip, ChipElements, ChipVariants } from "@web/components/Chip";
import { reviewOutcomeLabel } from "../../../../utils/state";
import type { Receipt } from "../../../../utils/receipt";
import styles from "./ReceiptTiles.module.scss";

export interface ReceiptTilesProps {
  receipt: Receipt;
  outcome: ReviewOutcome | undefined;
}

/** What the receipt comes to: the outcome, then chunks read, flags open and comments as tiles. */
export function ReceiptTiles({ receipt, outcome }: ReceiptTilesProps) {
  const { t } = useTranslation();

  return (
    <div className={styles["summary"]}>
      {outcome === undefined ? null : (
        <p className={styles["outcome"]}>
          {t("review.summary.outcomeLabel")}
          <Chip as={ChipElements.SPAN} variant={ChipVariants.FACT}>
            {reviewOutcomeLabel(t, outcome)}
          </Chip>
        </p>
      )}
      <dl className={styles["tiles"]}>
        <div className={styles["tile"]}>
          <dt>{t("brief.mobile.chunksRead")}</dt>
          <dd>
            {receipt.progress.reviewedChunks}/{receipt.progress.chunkTotal}
          </dd>
        </div>
        <div className={styles["tile"]}>
          <dt>{t("brief.mobile.flagsOpen")}</dt>
          <dd>{receipt.counts.open}</dd>
        </div>
        <div className={styles["tile"]}>
          <dt>{t("review.summary.inlineComments")}</dt>
          <dd>{receipt.comments.length}</dd>
        </div>
      </dl>
    </div>
  );
}
