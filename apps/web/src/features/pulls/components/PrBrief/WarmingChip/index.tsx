import { useTranslation } from "react-i18next";
import styles from "./WarmingChip.module.scss";

/** Shown next to a rendered brief while delta/comparison warmup still runs. */
export function WarmingChip() {
  const { t } = useTranslation();
  return (
    <span className={styles["warmingChip"]} role="status">
      {t("pulls.status.warmingChip")}
    </span>
  );
}
