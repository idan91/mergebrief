import { useTranslation } from "react-i18next";

import type { SpendLevel } from "../types";
import { deriveTickFills } from "../utils";
import styles from "./TickStrip.module.scss";

export interface TickStripProps {
  startedRuns: number;
  cap: number;
  level: SpendLevel;
}

export function TickStrip({ startedRuns, cap, level }: TickStripProps) {
  const { t } = useTranslation();
  const fills = deriveTickFills(startedRuns, cap);
  const label = t("spend.ticksLabel", { count: cap, started: startedRuns });

  return (
    <div
      aria-label={label}
      className={styles["strip"]}
      data-level={level}
      role="img"
    >
      {fills.map((filled, position) => (
        // oxlint-disable-next-line react/no-array-index-key -- a fixed-length strip: a tick's position is its identity
        <span className={styles["tick"]} data-filled={filled} key={position} />
      ))}
    </div>
  );
}
