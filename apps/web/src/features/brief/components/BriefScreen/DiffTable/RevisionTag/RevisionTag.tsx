import { useTranslation } from "react-i18next";

import type { ComparisonRun } from "../../../../comparison/comparison";
import styles from "./RevisionTag.module.scss";

export interface RevisionTagProps {
  run: ComparisonRun;
}

/**
 * The "new" or "removed" badge at the start of a revision run. Mounted for
 * that row only: a translation subscription per code cell would be one
 * per row on every row-set change.
 */
export function RevisionTag({ run }: RevisionTagProps) {
  const { t } = useTranslation();
  const label =
    run.kind === "removed"
      ? t("brief.diff.revRemoved")
      : t("brief.diff.revNew");

  return (
    <span className={styles["tag"]} data-kind={run.kind}>
      {label}
    </span>
  );
}
