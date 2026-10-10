import { useTranslation } from "react-i18next";

import {
  riskFlagDescription,
  type RiskFlag,
} from "../../../../../../../../model/utils/view-model";
import styles from "./CatalogChipDetail.module.scss";

export interface CatalogChipDetailProps {
  flag: RiskFlag;
}

export function CatalogChipDetail({ flag }: CatalogChipDetailProps) {
  const { t } = useTranslation();
  const catalog = riskFlagDescription(t, flag);
  if (flag.implication === undefined) {
    return <span className={styles["chipDetail"]}>{catalog}</span>;
  }
  return (
    <span className={styles["chipDetail"]}>
      <span>{catalog}</span>
      <span>{flag.implication}</span>
    </span>
  );
}
