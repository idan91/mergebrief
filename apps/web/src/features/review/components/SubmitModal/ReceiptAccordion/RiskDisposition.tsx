import { useTranslation } from "react-i18next";

import { receiptRiskGroups, type Receipt } from "../../../utils/receipt";
import { RiskGroup } from "./RiskGroup";

export interface RiskDispositionProps {
  receipt: Receipt;
}

export function RiskDisposition({ receipt }: RiskDispositionProps) {
  const { t } = useTranslation();
  return (
    <>
      {receiptRiskGroups(t, receipt).map((group) => (
        <RiskGroup
          items={group.items}
          key={group.key}
          reviewerWroteDetail={group.reviewerWroteDetail}
          title={group.title}
        />
      ))}
    </>
  );
}
