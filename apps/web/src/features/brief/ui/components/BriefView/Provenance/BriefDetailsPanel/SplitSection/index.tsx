import { useTranslation } from "react-i18next";

import { LocSign, LocSigns } from "@web/components/LocSign";
import type { ConcernShare } from "../../../Masthead/types";
import { hasConcernSplit, labelConcernShares } from "../../../Masthead/utils";
import panelStyles from "../BriefDetailsPanel.module.scss";
import styles from "./SplitSection.module.scss";

export interface SplitSectionProps {
  shares: readonly ConcernShare[];
}

/** The lines behind each Split share, for layouts whose Split bar shows only the percent. */
export function SplitSection({ shares }: SplitSectionProps) {
  const { t } = useTranslation();
  if (!hasConcernSplit(shares)) {
    return null;
  }

  const segments = labelConcernShares(t, shares);

  return (
    <section className={panelStyles["section"]} data-testid="details-split">
      <h2 className={panelStyles["heading"]}>{t("brief.masthead.split")}</h2>
      <dl className={panelStyles["facts"]}>
        {segments.map(({ key, name, share }) => (
          <div className={styles["row"]} key={key}>
            <dt>{name}</dt>
            <dd>
              <LocSign count={share.added} sign={LocSigns.ADD} />{" "}
              <LocSign count={share.deleted} sign={LocSigns.DEL} />{" "}
              <span className={styles["percent"]}>{share.percent}%</span>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
