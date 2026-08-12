import { useTranslation } from "react-i18next";
import styles from "./HeadAdvancedBanner.module.scss";

export interface HeadAdvancedBannerProps {
  /**
   * Absent when the newest briefed revision is already selected and the PR
   * head simply ran past it: the notice still holds, but there is nowhere to
   * navigate, and an action that resolves back to the current span is a
   * dead end.
   */
  onNavigate?: (() => void) | undefined;
}

/** Offered, never forced — the viewer stays pinned until they choose. */
export function HeadAdvancedBanner({ onNavigate }: HeadAdvancedBannerProps) {
  const { t } = useTranslation();
  return (
    <div className={styles["banner"]} role="status">
      <span>{t("pulls.headAdvanced.notice")}</span>
      {onNavigate ? (
        <button className="btn" onClick={onNavigate} type="button">
          {t("pulls.headAdvanced.action")}
        </button>
      ) : null}
    </div>
  );
}
