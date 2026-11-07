import { useTranslation } from "react-i18next";

import type { Receipt, ReceiptLine } from "../../../utils/receipt";
import type { ReviewOutcome } from "types/reviews";
import { CommentList } from "./CommentList";
import { GenerationMetrics } from "./GenerationMetrics";
import { NotCheckedList } from "./NotCheckedList";
import { RawReceipt } from "./RawReceipt";
import { ReceiptRows } from "./ReceiptRows";
import { RiskDisposition } from "./RiskDisposition";
import { Icon } from "@web/components/Icon";
import { IconNames, IconSizes } from "@web/components/Icon/types";
import styles from "./ReceiptAccordion.module.scss";

export interface ReceiptAccordionProps {
  receipt: Receipt;
  outcome: ReviewOutcome | undefined;
  /** The frozen receipt's lines, shown in the raw fold. */
  rawLines: readonly ReceiptLine[];
  signatureLine?: string | undefined;
}

/** The modal receipt view: the counts as plain rows, the rest under one Details disclosure. */
export function ReceiptAccordion({
  receipt,
  outcome,
  rawLines,
  signatureLine,
}: ReceiptAccordionProps) {
  const { t } = useTranslation();
  return (
    <div className={styles["stack"]}>
      <ReceiptRows outcome={outcome} receipt={receipt} />
      <details className={styles["fold"]}>
        <summary>
          <Icon
            className={styles["marker"]}
            name={IconNames.CARET_DOWN}
            size={IconSizes.SM}
          />
          {t("review.submit.details")}
        </summary>
        <div className={styles["detailsBody"]}>
          {signatureLine === undefined ? null : (
            <div className={styles["signature"]}>{signatureLine}</div>
          )}
          {receipt.generation === undefined ? null : (
            <dl className={styles["metrics"]}>
              <GenerationMetrics generation={receipt.generation} />
            </dl>
          )}
          <section>
            <h3 className={styles["sectionHeading"]}>
              {t("review.submit.receiptCommentsFold", {
                total: receipt.comments.length,
              })}
            </h3>
            <CommentList comments={receipt.comments} />
          </section>
          <section>
            <h3 className={styles["sectionHeading"]}>
              {t("review.submit.receiptRiskFold", {
                addressed: receipt.counts.addressed,
                dismissed: receipt.counts.dismissed,
                open: receipt.counts.open,
              })}
            </h3>
            <RiskDisposition receipt={receipt} />
          </section>
          <section>
            <h3 className={styles["sectionHeading"]}>
              {t("review.summary.notCheckedHeading")}
            </h3>
            <NotCheckedList />
          </section>
          <details className={styles["fold"]}>
            <summary>
              <Icon
                className={styles["marker"]}
                name={IconNames.CARET_DOWN}
                size={IconSizes.SM}
              />
              {t("review.submit.receiptShowRaw")}
            </summary>
            <RawReceipt lines={rawLines} />
          </details>
        </div>
      </details>
    </div>
  );
}
