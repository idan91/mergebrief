import { useTranslation } from "react-i18next";

import styles from "./NoInstallationLine.module.scss";

export interface NoInstallationLineProps {
  /** The App's new-installation page; null when the instance published none. */
  installUrl: string | null;
}

/** One quiet line under the URL box when GitHub shows the viewer no installation. */
export function NoInstallationLine({ installUrl }: NoInstallationLineProps) {
  const { t } = useTranslation();

  return (
    <p className={styles["line"]} data-testid="no-installation">
      {t("home.noInstallation.line")}
      {installUrl === null ? null : (
        <>
          {" "}
          <a className={styles["install"]} href={installUrl}>
            {t("home.noInstallation.install")}
          </a>
        </>
      )}
    </p>
  );
}
