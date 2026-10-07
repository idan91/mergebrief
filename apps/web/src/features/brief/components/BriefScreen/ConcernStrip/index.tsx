import { useTranslation } from "react-i18next";

import { LocSign, LocSigns } from "@web/components/LocSign";
import type { ConcernRollup } from "../../../types";
import { SplitSegmentKinds, concernShares } from "./utils";
import styles from "./ConcernStrip.module.scss";

export interface ConcernStripProps {
  /** The brief's full rollup: always the whole brief, never a scope cut. */
  rollup: ConcernRollup[];
  remainder?: { added: number; deleted: number } | undefined;
}

/**
 * The one-line attention-split strip between the banner lane and the
 * toolbar: per-concern share of the changed lines, plus the Unattributed
 * remainder as a last neutral segment. Informational only: no filtering,
 * navigation, or disclosure. Absent entirely below two concerns (a
 * single-concern split says nothing; residue does not count).
 */
export function ConcernStrip({ rollup, remainder }: ConcernStripProps) {
  const { t } = useTranslation();
  const shares = concernShares(rollup, remainder);
  const concernCount = shares.filter(
    (share) => share.kind === SplitSegmentKinds.CONCERN,
  ).length;
  if (concernCount < 2) {
    return null;
  }
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
      {shares.map((share) => {
        if (share.kind === SplitSegmentKinds.UNATTRIBUTED_REMAINDER) {
          return (
            <span
              className={styles["segment"]}
              data-kind={SplitSegmentKinds.UNATTRIBUTED_REMAINDER}
              key={SplitSegmentKinds.UNATTRIBUTED_REMAINDER}
            >
              <span aria-hidden="true" className={styles["dot"]} />
              <span className={styles["name"]}>
                {t("brief.unattributed.label")}
              </span>
              <span aria-hidden="true" className={styles["bar"]}>
                <i style={{ inlineSize: `${share.percent}%` }} />
              </span>
              <span className={styles["percent"]}>{share.percent}%</span>
              <span className={styles["loc"]}>
                <LocSign sign={LocSigns.ADD} count={share.added} />{" "}
                <LocSign sign={LocSigns.DEL} count={share.deleted} />
              </span>
            </span>
          );
        }
        return (
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
              <LocSign sign={LocSigns.ADD} count={share.added} />{" "}
              <LocSign sign={LocSigns.DEL} count={share.deleted} />
            </span>
          </span>
        );
      })}
    </div>
  );
}
