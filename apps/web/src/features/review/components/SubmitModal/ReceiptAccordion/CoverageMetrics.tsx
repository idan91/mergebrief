import { useTranslation } from "react-i18next";

import type { Receipt } from "../../../utils/receipt";
import styles from "./ReceiptAccordion.module.scss";

export interface CoverageMetricsProps {
  receipt: Receipt;
}

export function CoverageMetrics({ receipt }: CoverageMetricsProps) {
  const { t } = useTranslation();
  return (
    <dl className={styles["metrics"]}>
      <div>
        <dt>{t("review.summary.chunksReviewed")}</dt>
        <dd>
          {receipt.progress.reviewedChunks}/{receipt.progress.chunkTotal}
        </dd>
      </div>
      <div>
        <dt>{t("review.submit.receiptRiskFlagTotal")}</dt>
        <dd>{receipt.progress.flagTotal}</dd>
      </div>
      <div>
        <dt>{t("review.summary.inlineComments")}</dt>
        <dd>{receipt.comments.length}</dd>
      </div>
    </dl>
  );
}
