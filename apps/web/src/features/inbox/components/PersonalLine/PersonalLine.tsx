import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

import type { InboxCounts } from "../../types";
import styles from "./PersonalLine.module.scss";

export interface PersonalLineProps {
  counts: InboxCounts;
  /** No row at all: the slot says so instead of counting. */
  empty?: boolean;
}

interface PersonalCopy {
  readonly heading: string;
  readonly detail: string;
}

/** The detail for one waiting row names its state outright. */
function describeOneRow(t: TFunction, counts: InboxCounts): string {
  if (counts.updated === 1) return t("home.personalLine.oneChanged");
  if (counts.new === 1) return t("home.personalLine.oneNew");
  return t("home.personalLine.oneInProgress");
}

/** The detail for several rows lists the non-zero states, what changed first. */
function describeRows(t: TFunction, counts: InboxCounts): string {
  const parts: string[] = [];
  if (counts.updated > 0) {
    parts.push(t("home.personalLine.partChanged", { count: counts.updated }));
  }
  if (counts.new > 0) {
    parts.push(t("home.personalLine.partNew", { count: counts.new }));
  }
  if (counts.inProgress > 0) {
    parts.push(
      t("home.personalLine.partInProgress", { count: counts.inProgress }),
    );
  }
  const separator = t("home.personalLine.detailSeparator");
  return t("home.personalLine.detail", { parts: parts.join(separator) });
}

function shapePersonalCopy(
  t: TFunction,
  counts: InboxCounts,
  empty: boolean,
): PersonalCopy {
  if (empty) {
    return {
      heading: t("home.empty.heading"),
      detail: t("home.empty.detail"),
    };
  }
  const waiting = counts.updated + counts.new + counts.inProgress;
  if (waiting === 0) {
    return {
      heading: t("home.personalLine.caughtUp"),
      detail: t("home.personalLine.caughtUpDetail"),
    };
  }
  const heading = t("home.personalLine.attention", { count: waiting });
  const detail =
    waiting === 1 ? describeOneRow(t, counts) : describeRows(t, counts);
  return { heading, detail };
}

/** Leads with the one fact only this product knows: what is waiting on the reviewer, and why. */
export function PersonalLine({ counts, empty = false }: PersonalLineProps) {
  const { t } = useTranslation();
  const copy = shapePersonalCopy(t, counts, empty);

  return (
    <div className={styles["personal"]}>
      <h1 className={styles["heading"]}>{copy.heading}</h1>
      <p className={styles["detail"]}>{copy.detail}</p>
    </div>
  );
}
