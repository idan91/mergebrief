import { useTranslation } from "react-i18next";

import type { Receipt } from "../../../utils/receipt";
import type { ReviewOutcome } from "types/reviews";
import { CommentList } from "./CommentList";
import { CoverageMetrics } from "./CoverageMetrics";
import { NotCheckedList } from "./NotCheckedList";
import { OutcomeCard } from "./OutcomeCard";
import { RiskDisposition } from "./RiskDisposition";
import { Icon } from "@web/components/Icon";
import { IconNames, IconSizes } from "@web/components/Icon/types";
import styles from "./ReceiptAccordion.module.scss";

export interface ReceiptAccordionProps {
  receipt: Receipt;
  outcome: ReviewOutcome;
  /** The frozen artifact text, exactly as posted to GitHub. */
  raw: string;
}

/** The modal receipt view: outcome pinned, everything else a fold with its
 * counts in the summary; coverage open by default, raw artifact collapsed. */
export function ReceiptAccordion({
  receipt,
  outcome,
  raw,
}: ReceiptAccordionProps) {
  const { t } = useTranslation();
  return (
    <div className={styles["stack"]}>
      <OutcomeCard outcome={outcome} receipt={receipt} />
      <details className={styles["fold"]} open>
        <summary>
          <Icon
            className={styles["marker"]}
            name={IconNames.CARET_DOWN}
            size={IconSizes.SM}
          />
          {t("review.summary.coveredHeading")}
        </summary>
        <CoverageMetrics receipt={receipt} />
      </details>
      <details className={styles["fold"]}>
        <summary>
          <Icon
            className={styles["marker"]}
            name={IconNames.CARET_DOWN}
            size={IconSizes.SM}
          />
          {t("review.submit.receiptCommentsFold", {
            total: receipt.comments.length,
          })}
        </summary>
        <CommentList comments={receipt.comments} />
      </details>
      <details className={styles["fold"]}>
        <summary>
          <Icon
            className={styles["marker"]}
            name={IconNames.CARET_DOWN}
            size={IconSizes.SM}
          />
          {t("review.submit.receiptRiskFold", {
            addressed: receipt.counts.addressed,
            dismissed: receipt.counts.dismissed,
            open: receipt.counts.open,
          })}
        </summary>
        <RiskDisposition receipt={receipt} />
      </details>
      <details className={styles["fold"]}>
        <summary>
          <Icon
            className={styles["marker"]}
            name={IconNames.CARET_DOWN}
            size={IconSizes.SM}
          />
          {t("review.summary.notCheckedHeading")}
        </summary>
        <NotCheckedList />
      </details>
      <details className={styles["fold"]}>
        <summary>
          <Icon
            className={styles["marker"]}
            name={IconNames.CARET_DOWN}
            size={IconSizes.SM}
          />
          {t("review.submit.receiptShowRaw")}
        </summary>
        <pre className={styles["rawBody"]}>{raw}</pre>
      </details>
    </div>
  );
}
