import { useTranslation } from "react-i18next";

import { Icon } from "@web/components/Icon";
import {
  IconNames,
  IconRotations,
  IconSizes,
} from "@web/components/Icon/types";
import { IconButton } from "@web/components/IconButton";
import type { ComparisonOverlayState } from "../../../../model/comparison/comparison-overlay";
import { CompareParams } from "../../../../model/comparison/types";
import styles from "./ChangeStepper.module.scss";

export interface ChangeStepperProps {
  comparison: ComparisonOverlayState;
  jumpPrev: () => void;
  jumpNext: () => void;
  /** 44px steps with the count across the row, for a stepper in a sheet. */
  sheet?: boolean;
}

/** The compare mode's change count with Previous and Next change; absent with no change to step. */
export function ChangeStepper({
  comparison,
  jumpPrev,
  jumpNext,
  sheet,
}: ChangeStepperProps) {
  const { t } = useTranslation();
  const hasChanges = comparison.available && comparison.runCount > 0;
  if (!hasChanges) {
    return null;
  }

  const groupLabel =
    comparison.compare === CompareParams.LAST_REVIEW
      ? t("brief.toolbar.ariaLabelChangeStepperLastReview")
      : t("brief.toolbar.ariaLabelChangeStepperRevision");

  return (
    <span
      aria-label={groupLabel}
      className={styles["stepper"]}
      data-layout={sheet ? "sheet" : undefined}
      role="group"
    >
      <span className={styles["count"]}>
        {t("brief.toolbar.changes", { count: comparison.runCount })}
      </span>
      <IconButton
        className={styles["stepBtn"]}
        label={t("brief.toolbar.ariaLabelPreviousChange")}
        onClick={jumpPrev}
      >
        <Icon
          name={IconNames.CARET_DOWN}
          rotation={IconRotations.QUARTER}
          size={IconSizes.MD}
        />
      </IconButton>
      <IconButton
        className={styles["stepBtn"]}
        label={t("brief.toolbar.ariaLabelNextChange")}
        onClick={jumpNext}
      >
        <Icon
          name={IconNames.CARET_DOWN}
          rotation={IconRotations.THREE_QUARTERS}
          size={IconSizes.MD}
        />
      </IconButton>
    </span>
  );
}
