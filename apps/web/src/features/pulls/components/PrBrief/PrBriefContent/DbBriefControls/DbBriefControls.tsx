// Revision navigator + View/Compare lenses, rendered inside the sticky page
// Header's control slot: the header measures itself into --top-bar-h, so the
// controls stay reachable after the focus-to-heading selection effect.
import { useTranslation } from "react-i18next";
import type {
  DbTimelinePoint,
  DbTimelineSelection,
} from "../../../../utils/dbTimeline";
import {
  DbCompareBar,
  type DbCompareBarProps,
} from "./DbCompareBar/DbCompareBar";
import { DbTimelineNavigator } from "./DbTimelineNavigator/DbTimelineNavigator";
import { StaleRevisionChip } from "./StaleRevisionChip/StaleRevisionChip";
import styles from "./DbBriefControls.module.scss";

export interface DbBriefControlsProps {
  /**
   * The revision timeline; absent on legacy metas without `revisions[]` —
   * the View/Compare lenses still render.
   */
  timeline?: DbTimelineSelection | undefined;
  onSelectRevision?: ((point: DbTimelinePoint) => void) | undefined;
  /** The View/Compare lens wiring. */
  compare: DbCompareBarProps;
  /**
   * Compact status line under the controls (e.g. a degraded revision link).
   * Display only — the page live region owns the SR announcement.
   */
  note?: string | undefined;
  /** The selected revision is read-only (not the PR's current span). */
  readOnly?: boolean | undefined;
  /** The rendered span is behind the PR head; absent when it is current. */
  staleHead?: boolean | undefined;
  /** Present only when a newer briefed revision exists to move to. */
  onGoToNewest?: (() => void) | undefined;
}

export function DbBriefControls({
  timeline,
  onSelectRevision,
  compare,
  note,
  readOnly,
  staleHead,
  onGoToNewest,
}: DbBriefControlsProps) {
  const { t } = useTranslation();
  const showRevisionRegion =
    timeline !== undefined || staleHead === true || readOnly === true;
  return (
    <>
      {showRevisionRegion ? (
        <div className={styles["revisionRow"]}>
          {timeline !== undefined && onSelectRevision !== undefined ? (
            <DbTimelineNavigator
              next={timeline.next}
              onSelect={onSelectRevision}
              points={timeline.points}
              previous={timeline.previous}
              selectedIndex={timeline.selectedIndex}
            />
          ) : null}
          {staleHead ? (
            <StaleRevisionChip {...(onGoToNewest ? { onGoToNewest } : {})} />
          ) : null}
          {readOnly ? (
            // Factual chip, not a verdict: the reachable REASON lives on the
            // disabled controls themselves (diff rows, submit).
            <span className={styles["readOnlyChip"]}>
              {t("pulls.compare.readOnlyChip")}
            </span>
          ) : null}
        </div>
      ) : null}
      <div className={styles["lensRegion"]}>
        <DbCompareBar {...compare} />
        {note !== undefined ? <p className={styles["note"]}>{note}</p> : null}
      </div>
    </>
  );
}
