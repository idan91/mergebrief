import { useTranslation } from "react-i18next";

import { Icon } from "@web/components/Icon";
import { IconNames, IconSizes } from "@web/components/Icon/types";
import styles from "./CappedNote.module.scss";

export function CappedNote() {
  const { t } = useTranslation();

  return (
    <p className={styles["note"]}>
      <Icon
        className={styles["icon"]}
        name={IconNames.WARNING}
        size={IconSizes.LG}
      />
      <span>{t("spend.cappedNote")}</span>
    </p>
  );
}
