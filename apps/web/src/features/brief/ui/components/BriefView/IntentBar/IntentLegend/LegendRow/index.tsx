import { useTranslation } from "react-i18next";

import { AlarmMark } from "../../AlarmMark";
import type { IntentLegendRow } from "../consts";
import styles from "./LegendRow.module.scss";

export interface LegendRowProps {
  row: IntentLegendRow;
}

/** One bucket's name, its alarm mark where it carries one, and its meaning. */
export function LegendRow({ row }: LegendRowProps) {
  const { t } = useTranslation();
  const mark = row.alarm ? (
    <AlarmMark label={t("brief.intent.legendMarkName")} />
  ) : null;

  return (
    <div className={styles["row"]}>
      <dt className={styles["term"]}>
        {t(row.labelKey)}
        {mark}
      </dt>
      <dd className={styles["definition"]}>{t(row.definitionKey)}</dd>
    </div>
  );
}
