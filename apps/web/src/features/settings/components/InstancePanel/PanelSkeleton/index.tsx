import { useTranslation } from "react-i18next";

import styles from "./PanelSkeleton.module.scss";

export function PanelSkeleton() {
  const { t } = useTranslation();

  return (
    <div
      aria-busy="true"
      aria-label={t("spend.loading")}
      className={styles["skeleton"]}
      role="status"
    >
      <span className={styles["line"]} data-size="lead" />
      <span className={styles["line"]} data-size="bar" />
      <span className={styles["line"]} data-size="text" />
      <span className={styles["line"]} data-size="text-short" />
    </div>
  );
}
