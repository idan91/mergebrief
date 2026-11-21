import { useTranslation } from "react-i18next";

import { IconNames } from "@web/components/Icon/types";
import { splitUnmetConditions } from "../held-head";
import type { HeldCondition } from "../held-head/types";
import { ConditionGroup } from "./ConditionGroup";
import { GroupHeadingLevels } from "./consts";
import type { HeldConditionsLayout } from "./types";
import styles from "./HeldConditions.module.scss";

export interface HeldConditionsProps {
  unmetConditions: readonly HeldCondition[];
  /** The list left out an item the server could not read. */
  unmetConditionsPartial: boolean;
  layout: HeldConditionsLayout;
}

/**
 * A held head's unmet conditions in two groups, what it waits on and what
 * needs a change, then a line for any the server could not read.
 */
export function HeldConditions({
  unmetConditions,
  unmetConditionsPartial,
  layout,
}: HeldConditionsProps) {
  const { t } = useTranslation();
  const { waits, needs } = splitUnmetConditions(unmetConditions);
  const headingLevel = GroupHeadingLevels[layout];

  return (
    <div
      className={styles["groups"]}
      data-testid="held-conditions"
      data-variant={layout}
    >
      <ConditionGroup
        conditions={waits}
        headingLevel={headingLevel}
        icon={IconNames.HOURGLASS_MEDIUM}
        title={t("pulls.held.groups.waiting")}
      />
      <ConditionGroup
        conditions={needs}
        headingLevel={headingLevel}
        icon={IconNames.HAND_PALM}
        title={t("pulls.held.groups.needs")}
      />
      {unmetConditionsPartial ? (
        <p className={styles["unreadable"]} data-testid="held-unreadable">
          {t("triggerCondition.unreadable")}
        </p>
      ) : null}
    </div>
  );
}
