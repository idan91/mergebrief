import { useTranslation } from "react-i18next";

import { Button, ButtonVariants } from "@web/components/Button";
import { Icon } from "@web/components/Icon";
import { IconNames } from "@web/components/Icon/types";
import { UrlBox } from "../UrlBox";
import styles from "./InstallFirst.module.scss";

export interface InstallFirstProps {
  /** The App's new-installation page. */
  installUrl: string;
  /** False in the hosted demo, which cannot generate. */
  canGenerate: boolean;
}

/** A first run's two paths: install the App, which is what makes the product work, or brief one pull request. */
export function InstallFirst({ canGenerate, installUrl }: InstallFirstProps) {
  const { t } = useTranslation();

  return (
    <div className={styles["paths"]} data-testid="install-first">
      <Button
        as="a"
        className={styles["install"]}
        href={installUrl}
        variant="primary"
      >
        <Icon name={IconNames.GITHUB_LOGO} />
        {t("home.empty.installAction")}
      </Button>
      {canGenerate ? (
        <div className={styles["paste"]}>
          <p className={styles["label"]}>{t("home.empty.urlBoxLabel")}</p>
          {/* Install is a first run's one primary, so Generate steps down beside it. */}
          <UrlBox generateVariant={ButtonVariants.SECONDARY} />
        </div>
      ) : null}
    </div>
  );
}
