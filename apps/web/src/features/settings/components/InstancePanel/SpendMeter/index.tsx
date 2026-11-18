import { useTranslation } from "react-i18next";

import type { SpendLevel } from "../types";
import { deriveMeterFillPercent } from "../utils";
import styles from "./SpendMeter.module.scss";

export interface SpendMeterProps {
  startedRuns: number;
  cap: number;
  level: SpendLevel;
}

export function SpendMeter({ startedRuns, cap, level }: SpendMeterProps) {
  const { t } = useTranslation();
  const label = t("spend.ticksLabel", { count: cap, started: startedRuns });
  const anyStarted = startedRuns > 0;
  const fillPercent = deriveMeterFillPercent(startedRuns, cap);
  const fillStyle = { inlineSize: `${fillPercent}%` };

  return (
    <div
      aria-label={label}
      className={styles["track"]}
      data-level={level}
      role="img"
    >
      {anyStarted ? (
        <span className={styles["fill"]} style={fillStyle} />
      ) : undefined}
    </div>
  );
}
