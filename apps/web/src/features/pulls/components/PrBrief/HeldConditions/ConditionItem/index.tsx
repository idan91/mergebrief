import { useTranslation } from "react-i18next";
import type { UnmetPlainCondition } from "types/trigger-conditions";

import {
  Chip,
  ChipElements,
  ChipTones,
  ChipVariants,
} from "@web/components/Chip";
import { describeUnmetReasons } from "../../held-head";
import styles from "./ConditionItem.module.scss";

export interface ConditionItemProps {
  condition: UnmetPlainCondition;
}

/**
 * One condition's reasons and whose setting it is. The chip's short owner is
 * for the eye; a screen reader hears the full owner phrase instead.
 */
export function ConditionItem({ condition }: ConditionItemProps) {
  const { t } = useTranslation();
  const reasons = describeUnmetReasons(t, condition);
  const owner = t(`pulls.held.owner.${condition.source}`);
  const spokenOwner = t(`triggerCondition.owner.${condition.source}`);

  return (
    <li className={styles["item"]} data-testid="held-condition">
      <span className={styles["reasons"]}>
        {reasons.map((reason) => (
          <span className={styles["reason"]} key={reason}>
            {reason}
          </span>
        ))}
        <span className="sr-only">{spokenOwner}</span>
      </span>
      <Chip
        aria-hidden="true"
        as={ChipElements.SPAN}
        className={styles["owner"]}
        data-testid="held-condition-owner"
        tone={ChipTones.MUTED}
        variant={ChipVariants.FACT}
      >
        {owner}
      </Chip>
    </li>
  );
}
