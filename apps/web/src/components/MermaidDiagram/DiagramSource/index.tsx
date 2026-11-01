import { useTranslation } from "react-i18next";

import styles from "./DiagramSource.module.scss";

export interface DiagramSourceProps {
  code: string;
}

/** The fence as the author wrote it, one disclosure away. */
export function DiagramSource({ code }: DiagramSourceProps) {
  const { t } = useTranslation();
  return (
    <details className={styles["source"]}>
      <summary className={styles["summary"]}>
        {t("shell.media.diagramSource")}
      </summary>
      <pre className={styles["code"]}>
        <code className="language-mermaid">{code}</code>
      </pre>
    </details>
  );
}
