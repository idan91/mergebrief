import { useTranslation } from "react-i18next";

import { receiptRiskGroups, type Receipt } from "../../../utils/receipt";
import { DispositionKinds } from "../../../session/types";
import { RiskGroup } from "./RiskGroup";
import { listShownRiskGroups } from "./utils";
import styles from "./ReceiptBody.module.scss";

export interface RiskDispositionProps {
  receipt: Receipt;
}

export function RiskDisposition({ receipt }: RiskDispositionProps) {
  const { t } = useTranslation();
  const groups = listShownRiskGroups(receiptRiskGroups(t, receipt));

  if (groups.length === 0) {
    return <p className={styles["empty"]}>{t("review.summary.none")}</p>;
  }
  const onlyOpenRisks =
    groups.length === 1 && groups[0]?.key === DispositionKinds.OPEN;
  const rows = groups.map((group) => ({
    group,
    showDetail: group.key !== DispositionKinds.OPEN,
    title: onlyOpenRisks ? undefined : group.title,
  }));

  return (
    <>
      {rows.map(({ group, showDetail, title }) => (
        <RiskGroup
          items={group.items}
          key={group.key}
          reviewerWroteDetail={group.reviewerWroteDetail}
          showDetail={showDetail}
          title={title}
        />
      ))}
    </>
  );
}
