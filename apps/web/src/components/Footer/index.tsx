import { useTranslation } from "react-i18next";
import styles from "./Footer.module.scss";

export function Footer() {
  const { t } = useTranslation();
  return (
    <footer className={styles["footer"]}>
      {t("shell.footerRights", { year: new Date().getFullYear() })}
    </footer>
  );
}
