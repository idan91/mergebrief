import { useTranslation } from "react-i18next";

import { LocSign, LocSigns } from "@web/components/LocSign";
import { SplitSegmentKinds, type ConcernShare } from "../../types";
import styles from "./SplitRows.module.scss";

export interface SplitRowsProps {
  shares: readonly ConcernShare[];
}

/** One row per Split segment: the concern, its share, a bar and its lines. */
export function SplitRows({ shares }: SplitRowsProps) {
  const { t } = useTranslation();

  return (
    <ul
      aria-label={t("brief.masthead.splitLabel")}
      className={styles["rows"]}
      data-testid="split-rows"
    >
      {shares.map((share) => {
        const remainder =
          share.kind === SplitSegmentKinds.UNATTRIBUTED_REMAINDER;
        const key = remainder ? share.kind : share.concern;
        const name = remainder ? t("brief.unattributed.label") : share.concern;
        const barStyle = { inlineSize: `${String(share.percent)}%` };
        return (
          <li
            className={styles["row"]}
            data-concern={remainder ? undefined : share.concern}
            key={key}
          >
            <span className={styles["name"]}>
              <span aria-hidden="true" className={styles["dot"]} />
              {name}
            </span>
            <span className={styles["loc"]}>
              <LocSign sign={LocSigns.ADD} count={share.added} />{" "}
              <LocSign sign={LocSigns.DEL} count={share.deleted} />
            </span>
            <span className={styles["percent"]}>{share.percent}%</span>
            <span aria-hidden="true" className={styles["bar"]}>
              <i style={barStyle} />
            </span>
          </li>
        );
      })}
    </ul>
  );
}
