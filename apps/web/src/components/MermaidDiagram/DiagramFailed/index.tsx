import { useTranslation } from "react-i18next";

import styles from "./DiagramFailed.module.scss";

export interface DiagramFailedProps {
  code: string;
}

/** A fence Mermaid could not draw: the code block under a one-line note. */
export function DiagramFailed({ code }: DiagramFailedProps) {
  const { t } = useTranslation();
  return (
    <div className={styles["failed"]}>
      <p className={styles["note"]}>{t("shell.media.diagramFailed")}</p>
      <pre className={styles["code"]}>
        <code className="language-mermaid">{code}</code>
      </pre>
    </div>
  );
}
