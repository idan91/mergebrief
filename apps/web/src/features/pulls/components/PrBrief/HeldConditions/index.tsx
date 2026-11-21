import { useTranslation } from "react-i18next";
import type { UnmetCondition } from "types/trigger-conditions";

import { IconNames } from "@web/components/Icon/types";
import { splitUnmetConditions } from "../held-head";
import { ConditionGroup } from "./ConditionGroup";
import { GroupHeadingLevels } from "./consts";
import type { HeldConditionsLayout } from "./types";
import styles from "./HeldConditions.module.scss";

export interface HeldConditionsProps {
  unmet: readonly UnmetCondition[];
  layout: HeldConditionsLayout;
}

/** A held head's unmet conditions in two groups: what it waits on, and what needs a change. */
export function HeldConditions({ unmet, layout }: HeldConditionsProps) {
  const { t } = useTranslation();
  const { waits, needs } = splitUnmetConditions(unmet);
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
    </div>
  );
}
