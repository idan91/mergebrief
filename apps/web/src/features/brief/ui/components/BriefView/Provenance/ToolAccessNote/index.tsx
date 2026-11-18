import { useTranslation } from "react-i18next";

import styles from "./ToolAccessNote.module.scss";

/** Says a harness CLI that keeps built-in tools wrote the brief. */
export function ToolAccessNote() {
  const { t } = useTranslation();

  return (
    <span className={styles["note"]} data-testid="tool-access-note">
      {t("brief.masthead.toolAccessNote")}
    </span>
  );
}
