import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import styles from "./StackBase.module.scss";

export interface StackBaseProps {
  /** The branch the whole stack targets, when the stack records one. */
  baseRef?: string | undefined;
  /** A control at the bar's end, such as the stack-version toggle. */
  children?: ReactNode;
}

/** The bar under the list: the stack's base branch, aligned with the rows above it. */
export function StackBase({ baseRef, children }: StackBaseProps) {
  const { t } = useTranslation();

  return (
    <span className={styles["base"]}>
      {baseRef === undefined ? null : (
        <>
          <span className={styles["label"]}>{t("brief.header.stackBase")}</span>
          <code className={styles["branch"]}>{baseRef}</code>
        </>
      )}
      {children === undefined ? null : (
        <span className={styles["end"]}>{children}</span>
      )}
    </span>
  );
}
