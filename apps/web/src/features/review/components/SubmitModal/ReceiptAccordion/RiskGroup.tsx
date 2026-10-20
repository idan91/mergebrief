import { useTranslation } from "react-i18next";

import { MentionText } from "@web/components/Markdown/MentionText";

import type { ReceiptRiskRow } from "../../../utils/receipt";
import { shortFile } from "../../../utils/receipt";
import styles from "./ReceiptAccordion.module.scss";

export interface RiskGroupProps {
  title: string;
  items: ReceiptRiskRow[];
  /** The details are text the reviewer wrote, such as dismiss reasons. */
  reviewerWroteDetail: boolean;
}

export function RiskGroup({
  title,
  items,
  reviewerWroteDetail,
}: RiskGroupProps) {
  const { t } = useTranslation();
  return (
    <div className={styles["riskGroup"]}>
      <h3>{title}</h3>
      {items.length === 0 ? (
        <p className={styles["empty"]}>{t("review.summary.none")}</p>
      ) : null}
      {items.map((item) => (
        <div className={styles["itemRow"]} key={item.id}>
          <span>
            {item.attr} · {shortFile(item.file)}
          </span>
          <small>
            {reviewerWroteDetail ? (
              <MentionText text={item.detail} />
            ) : (
              item.detail
            )}
          </small>
        </div>
      ))}
    </div>
  );
}
