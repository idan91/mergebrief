import { useTranslation } from "react-i18next";

import {
  NO_CODE_OUTLINE_NOTE_KEYS,
  OUTLINE_FORM_KEYS,
  type ReceiptGeneration,
} from "../../../../utils/receipt";
import styles from "./GenerationMetrics.module.scss";
import { formatShortenedLine } from "./utils";

export interface GenerationMetricsProps {
  generation: ReceiptGeneration;
}

/** What a multi-call run's grouping read and which files the model saw by their facts. */
export function GenerationMetrics({ generation }: GenerationMetricsProps) {
  const { t } = useTranslation();
  const outlineLabel = t(OUTLINE_FORM_KEYS[generation.outlineForm]);
  const noCodeNoteKey = NO_CODE_OUTLINE_NOTE_KEYS[generation.outlineForm];
  const shortenedLine = formatShortenedLine(t, generation.shortened);

  return (
    <>
      <div>
        <dt>{t("review.summary.outlineRead")}</dt>
        <dd data-testid="receipt-outline-form">
          {outlineLabel}
          {noCodeNoteKey !== undefined ? (
            <span className={styles["metricNote"]}>{t(noCodeNoteKey)}</span>
          ) : null}
        </dd>
      </div>
      {shortenedLine !== undefined ? (
        <div>
          <dt>{t("review.summary.shortenedFiles")}</dt>
          <dd data-testid="receipt-shortened-files">{shortenedLine}</dd>
        </div>
      ) : null}
    </>
  );
}
