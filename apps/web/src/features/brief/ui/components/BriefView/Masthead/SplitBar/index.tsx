import { useTranslation } from "react-i18next";

import type { ConcernShare } from "../types";
import { hasConcernSplit, labelConcernShares } from "../utils";
import { MIN_METER_GROW } from "./consts";
import { FactBar } from "../FactBar";
import styles from "./SplitBar.module.scss";

export interface SplitBarProps {
  shares: readonly ConcernShare[];
}

/** The concern Split as one segmented meter with a legend, for layouts with no card column. */
export function SplitBar({ shares }: SplitBarProps) {
  const { t } = useTranslation();
  if (!hasConcernSplit(shares)) {
    return null;
  }

  const segments = labelConcernShares(t, shares);
  const meter = (
    <span aria-hidden="true" className={styles["meter"]}>
      {segments.map(({ key, concern, share }) => {
        const segmentStyle = {
          flexGrow: Math.max(share.percent, MIN_METER_GROW),
        };
        return (
          <i
            className={styles["segment"]}
            data-concern={concern}
            key={key}
            style={segmentStyle}
          />
        );
      })}
    </span>
  );

  return (
    <FactBar aside={meter} testId="split-bar" title={t("brief.masthead.split")}>
      <ul
        aria-label={t("brief.masthead.splitLabel")}
        className={styles["legend"]}
      >
        {segments.map(({ key, concern, name, share }) => (
          <li className={styles["item"]} data-concern={concern} key={key}>
            <span aria-hidden="true" className={styles["dot"]} />
            {name}
            <b className={styles["percent"]}>{share.percent}%</b>
          </li>
        ))}
      </ul>
    </FactBar>
  );
}
