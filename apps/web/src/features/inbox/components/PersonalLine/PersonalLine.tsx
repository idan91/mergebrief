import { useTranslation } from "react-i18next";

import type { InboxCounts } from "../../types";
import styles from "./PersonalLine.module.scss";

export interface PersonalLineProps {
  counts: InboxCounts;
}

/** Leads with the one fact only this product knows: what changed since the reviewer looked. */
export function PersonalLine({ counts }: PersonalLineProps) {
  const { t } = useTranslation();
  const changed = counts.updated;
  const fresh = counts.new;

  let heading = t("home.personalLine.caughtUp");
  let detail = t("home.personalLine.caughtUpDetail");
  if (changed > 0) {
    heading = t("home.personalLine.changed", { count: changed });
    detail =
      fresh === 0
        ? t("home.personalLine.changedDetailNone")
        : t("home.personalLine.changedDetailNew", { count: fresh });
  } else if (fresh > 0) {
    heading = t("home.personalLine.new", { count: fresh });
    detail = t("home.personalLine.newDetail");
  }

  return (
    <div className={styles["personal"]}>
      <h1 className={styles["heading"]}>{heading}</h1>
      <p className={styles["detail"]}>{detail}</p>
    </div>
  );
}
