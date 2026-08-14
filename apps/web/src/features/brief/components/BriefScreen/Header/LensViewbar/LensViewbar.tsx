import { useTranslation } from "react-i18next";
import { useId } from "react";

import type { LensControlState, ViewMode } from "../../modeLegality";
import styles from "./LensViewbar.module.scss";

export interface LensViewbarProps {
  viewMode: ViewMode;

  /**
   * `disabled` greys the control — aria-disabled + no-op, never hard
   * `disabled` (that dumps keyboard focus) — and carries the honest reason.
   */
  lensControl: LensControlState;

  /** Selects a lens; the owner announces the reason when disabled. */
  selectLens: (mode: ViewMode) => void;
}

/**
 * The Story/Concerns lens group with its visible "View" label — the same
 * labeled-group vocabulary as the Compare control, rendered inside the lens
 * cluster on both control paths.
 */
export function LensViewbar({
  viewMode,
  lensControl,
  selectLens,
}: LensViewbarProps) {
  const { t } = useTranslation();

  const lensDisabled = lensControl.state === "disabled";
  const lensReasonId = useId();

  return (
    <fieldset
      className={styles["viewbar"]}
      data-state={lensDisabled ? "disabled" : undefined}
      title={lensDisabled ? lensControl.reason : undefined}
    >
      <legend className={styles["viewbarLegend"]}>
        {t("brief.header.viewLegend")}
      </legend>

      <div className={styles["viewbarGroup"]}>
        <label className={styles["viewOption"]}>
          <input
            aria-describedby={lensDisabled ? lensReasonId : undefined}
            aria-disabled={lensDisabled || undefined}
            checked={viewMode === "story"}
            className={styles["viewControl"]}
            name="review-view"
            type="radio"
            value="story"
            onChange={() => selectLens("story")}
          />
          <span className={styles["viewLabel"]}>
            {t("brief.header.viewStory")}
          </span>
        </label>

        <label className={styles["viewOption"]}>
          <input
            aria-describedby={lensDisabled ? lensReasonId : undefined}
            aria-disabled={lensDisabled || undefined}
            checked={viewMode === "concerns"}
            className={styles["viewControl"]}
            name="review-view"
            type="radio"
            value="concerns"
            onChange={() => selectLens("concerns")}
          />
          <span className={styles["viewLabel"]}>
            {t("brief.header.viewConcerns")}
          </span>
        </label>

        {lensDisabled ? (
          <span className="sr-only" id={lensReasonId}>
            {lensControl.reason}
          </span>
        ) : null}
      </div>
    </fieldset>
  );
}
