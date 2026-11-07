import { useTranslation } from "react-i18next";

import { MentionText } from "@web/components/Markdown/MentionText";
import { getRiskAttributeLabel } from "@web/features/brief/model";

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
  const itemRows = items.map((item) => {
    const attributeLabel = getRiskAttributeLabel(t, item.attr);
    return { item, attributeLabel, file: shortFile(item.file) };
  });

  return (
    <div className={styles["riskGroup"]}>
      <h4>{title}</h4>
      {items.length === 0 ? (
        <p className={styles["empty"]}>{t("review.summary.none")}</p>
      ) : null}
      {itemRows.map(({ item, attributeLabel, file }) => (
        <div className={styles["itemRow"]} key={item.id}>
          <span>
            {attributeLabel} · {file}
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
