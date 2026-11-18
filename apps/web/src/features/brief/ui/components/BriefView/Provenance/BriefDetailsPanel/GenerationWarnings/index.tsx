import type { Ref } from "react";
import { useTranslation } from "react-i18next";

import styles from "./GenerationWarnings.module.scss";

export interface GenerationWarningsProps {
  /** Anchor warnings first, each once. */
  warnings: readonly string[];
  /** The chip's landing target: focus moves here when it opens. */
  ref: Ref<HTMLDivElement>;
}

/** The warnings chip's whole surface; a capped scroll region, so a Tab stop. */
export function GenerationWarnings({ warnings, ref }: GenerationWarningsProps) {
  const { t } = useTranslation();

  return (
    <div
      aria-label={t("brief.details.ariaLabelWarnings")}
      className={styles["warnings"]}
      data-details-warnings=""
      ref={ref}
      role="region"
      tabIndex={0}
    >
      {/* oxlint-disable-next-line jsx-a11y/no-redundant-roles -- WebKit drops list semantics under list-style: none without it */}
      <ul className={styles["list"]} role="list">
        {warnings.map((warning) => (
          <li key={warning}>{warning}</li>
        ))}
      </ul>
    </div>
  );
}
