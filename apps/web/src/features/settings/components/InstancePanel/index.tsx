import { useTranslation } from "react-i18next";

import type { SettingsPanelProps } from "../../types";
import { CapConfig } from "./CapConfig";
import { CappedNote } from "./CappedNote";
import { PanelSkeleton } from "./PanelSkeleton";
import { SpendFailure } from "./SpendFailure";
import { SpendRefused } from "./SpendRefused";
import { SpendMeter } from "./SpendMeter";
import { SpendSentence } from "./SpendSentence";
import { SPEND_HEADING_ID } from "./consts";
import { useHandedOffFocus } from "./hooks/useHandedOffFocus";
import { SpendLevels } from "./types";
import { useInstancePanelFacade } from "./useInstancePanelFacade";
import styles from "./InstancePanel.module.scss";

export function InstancePanel({ active }: SettingsPanelProps) {
  const { t } = useTranslation();
  const {
    view,
    reading,
    failed,
    refused,
    stale,
    retry,
    focusHandedOff,
    handOffFocus,
    clearFocusHandOff,
  } = useInstancePanelFacade(active);
  const headingRef = useHandedOffFocus(focusHandedOff, clearFocusHandOff);

  if (refused) {
    return (
      <SpendRefused
        focusHandedOff={focusHandedOff}
        onFocusTaken={clearFocusHandOff}
      />
    );
  }
  if (failed) {
    return <SpendFailure onFocusHandOff={handOffFocus} onRetry={retry} />;
  }
  const loading = view === undefined || reading === undefined;
  if (loading) {
    return <PanelSkeleton />;
  }

  const capped = reading.level === SpendLevels.CAPPED;

  return (
    <section aria-labelledby={SPEND_HEADING_ID} className={styles["root"]}>
      <h2
        ref={headingRef}
        className={styles["heading"]}
        id={SPEND_HEADING_ID}
        tabIndex={-1}
      >
        {t("spend.heading")}
      </h2>
      <SpendSentence reading={reading} view={view} />
      {stale ? (
        <p className={styles["stale"]}>
          {t("spend.stale", { time: reading.readAtLocal })}
        </p>
      ) : undefined}
      {view.cap === undefined ? undefined : (
        <SpendMeter
          cap={view.cap}
          level={reading.level}
          startedRuns={view.startedRuns}
        />
      )}
      {capped ? <CappedNote /> : undefined}
      <CapConfig cap={view.cap} />
    </section>
  );
}
