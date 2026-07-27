// The DB route's unified control surface (BRIEF-24 UX pass): revision
// navigator + View/Compare lenses as ONE compact column, rendered inside the
// sticky page Header's control slot — the same place the local path's
// TimelineNavigator lives. Living in the header buys stickiness and offset
// propagation for free (the header measures itself into --top-bar-h), so the
// controls stay reachable after the focus-to-heading selection effect
// (ADR 0019 #7) instead of scrolling away.
import type {
  DbTimelinePoint,
  DbTimelineSelection,
} from "../../../../utils/dbTimeline";
import {
  DbCompareBar,
  type DbCompareBarProps,
} from "./DbCompareBar/DbCompareBar";
import { DbTimelineNavigator } from "./DbTimelineNavigator/DbTimelineNavigator";
import styles from "./DbBriefControls.module.scss";

export interface DbBriefControlsProps {
  /**
   * The revision timeline; absent on legacy metas without `revisions[]` —
   * the View/Compare lenses still render.
   */
  timeline?: DbTimelineSelection | undefined;
  onSelectRevision?: ((point: DbTimelinePoint) => void) | undefined;
  /** The View/Compare lens wiring (BRIEF-19/21 contract, unchanged). */
  compare: DbCompareBarProps;
  /**
   * Compact status line under the controls (e.g. a degraded revision link).
   * Display only — the page live region owns the SR announcement.
   */
  note?: string | undefined;
  /** The selected revision is read-only (not the PR's current span). */
  readOnly?: boolean | undefined;
}

export function DbBriefControls({
  timeline,
  onSelectRevision,
  compare,
  note,
  readOnly,
}: DbBriefControlsProps) {
  return (
    <div className={styles["controls"]}>
      {timeline !== undefined && onSelectRevision !== undefined ? (
        <div className={styles["revisionRow"]}>
          <DbTimelineNavigator
            next={timeline.next}
            onSelect={onSelectRevision}
            points={timeline.points}
            previous={timeline.previous}
            selectedIndex={timeline.selectedIndex}
          />
          {readOnly ? (
            // Factual chip, not a verdict: the reachable REASON lives on the
            // disabled controls themselves (diff rows, submit).
            <span className={styles["readOnlyChip"]}>read-only</span>
          ) : null}
        </div>
      ) : null}
      <DbCompareBar {...compare} />
      {note !== undefined ? <p className={styles["note"]}>{note}</p> : null}
    </div>
  );
}
