// The "behind the PR head" marker. It lives beside the revision control so it
// survives scrolling; the banner it replaces did not.
import { useTranslation } from "react-i18next";

import styles from "./StaleRevisionChip.module.scss";

export interface StaleRevisionChipProps {
  /** Absent when there is no newer briefed revision to move to. */
  onGoToNewest?: (() => void) | undefined;
}

export function StaleRevisionChip({ onGoToNewest }: StaleRevisionChipProps) {
  const { t } = useTranslation();
  const label = (
    <>
      <span aria-hidden="true" className={styles["dot"]} />
      {t("pulls.staleChip.label")}
    </>
  );
  if (onGoToNewest === undefined) {
    return (
      <span
        className={styles["chip"]}
        data-static=""
        data-testid="stale-revision-chip"
        title={t("pulls.staleChip.title")}
      >
        {label}
      </span>
    );
  }
  return (
    <button
      className={styles["chip"]}
      data-testid="stale-revision-chip"
      onClick={onGoToNewest}
      title={t("pulls.staleChip.title")}
      type="button"
    >
      {label}
      <span className={styles["action"]}>{t("pulls.staleChip.action")}</span>
    </button>
  );
}
