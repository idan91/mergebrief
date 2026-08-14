import { useTranslation } from "react-i18next";

import type { ConcernRollup } from "../../../types";
import { concernShares } from "./utils";
import styles from "./ConcernStrip.module.scss";

export interface ConcernStripProps {
  /** The brief's full rollup — always the whole brief, never a scope cut. */
  rollup: ConcernRollup[];
}

/**
 * The one-line attention-split strip between the banner lane and the
 * toolbar: per-concern share of the attributed changed lines. Informational
 * only — no filtering, navigation, or disclosure. Absent entirely below two
 * concerns (a single-concern split says nothing).
 */
export function ConcernStrip({ rollup }: ConcernStripProps) {
  const { t } = useTranslation();
  const shares = concernShares(rollup);
  if (shares.length < 2) return null;
  return (
    <div
      aria-label={t("brief.concernStrip.ariaLabel")}
      className={styles["strip"]}
      data-testid="concern-strip"
      role="group"
    >
      <span aria-hidden="true" className={styles["lead"]}>
        {t("brief.concernStrip.lead")}
      </span>
      {shares.map((share) => (
        <span
          className={styles["segment"]}
          data-concern={share.concern}
          key={share.concern}
        >
          <span aria-hidden="true" className={styles["dot"]} />
          <span className={styles["name"]}>{share.concern}</span>
          <span aria-hidden="true" className={styles["bar"]}>
            <i style={{ inlineSize: `${share.percent}%` }} />
          </span>
          <span className={styles["percent"]}>{share.percent}%</span>
          <span className={styles["loc"]}>
            <span className="green">+{share.added}</span>{" "}
            <span className="red">−{share.deleted}</span>
          </span>
        </span>
      ))}
    </div>
  );
}
