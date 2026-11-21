import { useTranslation } from "react-i18next";

import {
  Chip,
  ChipElements,
  ChipTones,
  ChipVariants,
} from "@web/components/Chip";
import { describeUnmetReasons } from "@web/utils/unmet-conditions";
import type { HeldPlainCondition } from "@web/utils/unmet-conditions/types";
import styles from "./ConditionItem.module.scss";

export interface ConditionItemProps {
  condition: HeldPlainCondition;
}

/**
 * One condition's reasons and whose setting it is. The chip's short label is
 * for the eye; a screen reader hears the full phrase instead.
 */
export function ConditionItem({ condition }: ConditionItemProps) {
  const { t } = useTranslation();
  const reasons = describeUnmetReasons(t, condition);
  const setBy = t(`pulls.held.setBy.${condition.setBy}`);
  const spokenSetBy = t(`triggerCondition.setBy.${condition.setBy}`);

  return (
    <li className={styles["item"]} data-testid="held-condition">
      <span className={styles["reasons"]}>
        {reasons.map((reason) => (
          <span className={styles["reason"]} key={reason}>
            {reason}
          </span>
        ))}
        <span className="sr-only">{spokenSetBy}</span>
      </span>
      <Chip
        aria-hidden="true"
        as={ChipElements.SPAN}
        className={styles["owner"]}
        data-testid="held-condition-owner"
        tone={ChipTones.MUTED}
        variant={ChipVariants.FACT}
      >
        {setBy}
      </Chip>
    </li>
  );
}
