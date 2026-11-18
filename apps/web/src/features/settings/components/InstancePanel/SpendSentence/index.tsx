import type { SpendView } from "contract";
import { Trans, useTranslation } from "react-i18next";

import type { SpendReading } from "../types";
import { resolveCountKey } from "../utils";
import { COUNT_EMPHASIS } from "./consts";
import styles from "./SpendSentence.module.scss";

export interface SpendSentenceProps {
  view: SpendView;
  reading: SpendReading;
}

export function SpendSentence({ view, reading }: SpendSentenceProps) {
  const { t } = useTranslation();
  const largeBreakdown =
    view.largeRuns === undefined
      ? undefined
      : t("spend.largeBreakdown", {
          count: view.largeRuns.runs,
          units: view.largeRuns.units,
        });
  const largeSentence =
    largeBreakdown === undefined ? undefined : <> {largeBreakdown}</>;

  if (view.cap === undefined) {
    return (
      <p className={styles["sentence"]}>
        <Trans
          components={COUNT_EMPHASIS}
          count={view.startedRuns}
          i18nKey="spend.uncapped"
        />
        {largeSentence}
      </p>
    );
  }

  const countKey = resolveCountKey(view.startedRuns, view.cap);
  const reset = reading.localIsUtc
    ? t("spend.resetsUtc", {
        utc: reading.resetUtc,
        relative: reading.resetRelative,
      })
    : t("spend.resetsLocal", {
        local: reading.resetLocal,
        utc: reading.resetUtc,
        relative: reading.resetRelative,
      });

  return (
    <p className={styles["sentence"]}>
      <Trans
        components={COUNT_EMPHASIS}
        count={view.cap}
        i18nKey={countKey}
        values={{ started: view.startedRuns, cap: view.cap }}
      />
      {largeSentence} {reset}
    </p>
  );
}
