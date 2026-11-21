// Scope and comparison controls + the Newer commits chip, rendered inside the sticky page
// Header's control slot: the header measures itself into --top-bar-h, so the
// controls stay reachable after the focus-to-heading selection effect.
import { useTranslation } from "react-i18next";
import { DbCompareBar, type DbCompareBarProps } from "./DbCompareBar";
import { NewerCommitsChip } from "./NewerCommitsChip";
import type { NewerCommitsChipState } from "./NewerCommitsChip/types";
import styles from "./DbBriefControls.module.scss";
import {
  HeldBehindChip,
  findCase,
  useHeldPrototype,
} from "@web/features/held-prototype";

export interface DbBriefControlsProps {
  /** The scope and comparison wiring. */
  compare: DbCompareBarProps;
  /**
   * Compact status line under the controls (e.g. a degraded revision link).
   * Display only; the page live region owns the SR announcement.
   */
  note?: string | undefined;
  /** The selected revision is read-only (not the PR's current span). */
  readOnly?: boolean | undefined;
  /** The newer-commits chip, present only while the brief on screen trails the PR. */
  newerCommits: NewerCommitsChipState;
}

export function DbBriefControls({
  compare,
  note,
  readOnly,
  newerCommits,
}: DbBriefControlsProps) {
  const { t } = useTranslation();
  const { status } = newerCommits;
  const proto = useHeldPrototype();
  const heldBehind =
    proto.active && proto.view === "card" && proto.caseId === "behind";
  const showRevisionRegion =
    readOnly === true || status !== undefined || heldBehind;
  return (
    <>
      <div className={styles["comparisonRegion"]}>
        <DbCompareBar {...compare} />
        {note !== undefined ? <p className={styles["note"]}>{note}</p> : null}
      </div>
      {showRevisionRegion ? (
        <div className={styles["revisionRow"]}>
          {heldBehind ? <HeldBehindChip held={findCase("behind")} /> : null}
          {status === undefined || heldBehind ? null : (
            <NewerCommitsChip status={status} />
          )}
          {readOnly ? (
            // Factual chip, not a verdict: the reachable REASON lives on the
            // disabled controls themselves (diff rows, submit).
            <span className={styles["readOnlyChip"]}>
              {t("pulls.compare.readOnlyChip")}
            </span>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
