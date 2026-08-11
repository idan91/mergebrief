import { useTranslation } from "react-i18next";
import styles from "./HeadAdvancedBanner.module.scss";

export interface HeadAdvancedBannerProps {
  onNavigate: () => void;
}

/** Offered, never forced — the viewer stays pinned until they choose. */
export function HeadAdvancedBanner({ onNavigate }: HeadAdvancedBannerProps) {
  const { t } = useTranslation();
  return (
    <div className={styles["banner"]} role="status">
      <span>{t("pulls.headAdvanced.notice")}</span>
      <button className="btn" onClick={onNavigate} type="button">
        {t("pulls.headAdvanced.action")}
      </button>
    </div>
  );
}
