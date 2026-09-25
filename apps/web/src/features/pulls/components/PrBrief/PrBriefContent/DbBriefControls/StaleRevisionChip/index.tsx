// The "behind the PR head" marker. It lives beside the revision control so it
// survives scrolling; the banner it replaces did not.
import { useTranslation } from "react-i18next";

import { Chip } from "@web/components/Chip";
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
      <Chip
        as="span"
        className={styles["chip"]}
        data-testid="stale-revision-chip"
        title={t("pulls.staleChip.title")}
        tone="warning"
      >
        {label}
      </Chip>
    );
  }
  return (
    <Chip
      className={styles["chip"]}
      data-testid="stale-revision-chip"
      title={t("pulls.staleChip.title")}
      tone="warning"
      onClick={onGoToNewest}
    >
      {label}
      <span className={styles["action"]}>{t("pulls.staleChip.action")}</span>
    </Chip>
  );
}
