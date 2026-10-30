import { useTranslation } from "react-i18next";

import styles from "./StackBase.module.scss";

export interface StackBaseProps {
  /** The branch the whole stack targets. */
  baseRef: string;
}

/** The stack's base branch under the list, aligned with the rows above it. */
export function StackBase({ baseRef }: StackBaseProps) {
  const { t } = useTranslation();

  return (
    <span className={styles["base"]}>
      <span className={styles["label"]}>{t("brief.header.stackBase")}</span>
      <code className={styles["branch"]}>{baseRef}</code>
    </span>
  );
}
