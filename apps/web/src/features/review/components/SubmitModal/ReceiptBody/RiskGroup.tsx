import { useTranslation } from "react-i18next";

import { MentionText } from "@web/components/Markdown/MentionText";
import { getRiskAttributeLabel } from "@web/features/brief/model";
import type { ReceiptRiskRow } from "../../../utils/receipt";
import { shortFile } from "../../../utils/receipt";
import styles from "./ReceiptBody.module.scss";

export interface RiskGroupProps {
  /** Absent when open risks are the only group, which the tab already names. */
  title?: string | undefined;
  items: ReceiptRiskRow[];
  /** The details are text the reviewer wrote, such as dismiss reasons. */
  reviewerWroteDetail: boolean;
  /** An open risk's detail only restates that it is open. */
  showDetail: boolean;
}

export function RiskGroup({
  title,
  items,
  reviewerWroteDetail,
  showDetail,
}: RiskGroupProps) {
  const { t } = useTranslation();
  const itemRows = items.map((item) => {
    const attributeLabel = getRiskAttributeLabel(t, item.attr);
    return { item, attributeLabel, file: shortFile(item.file) };
  });

  return (
    <div>
      {title === undefined ? null : (
        <h3 className={styles["groupHeading"]}>{title}</h3>
      )}
      {itemRows.map(({ item, attributeLabel, file }) => (
        <div className={styles["itemRow"]} key={item.id}>
          <div className={styles["itemHead"]}>
            <b>{attributeLabel}</b>
            <span className={styles["itemAnchor"]}>
              <code title={file}>
                <bdi dir="ltr">{file}</bdi>
              </code>
            </span>
          </div>
          {showDetail ? (
            <p className={styles["itemDetail"]}>
              {reviewerWroteDetail ? (
                <MentionText text={item.detail} />
              ) : (
                item.detail
              )}
            </p>
          ) : null}
        </div>
      ))}
    </div>
  );
}
