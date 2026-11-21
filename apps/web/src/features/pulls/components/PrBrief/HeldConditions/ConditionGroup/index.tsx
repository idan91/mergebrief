import { useId } from "react";
import { UnmetConditionKinds } from "types/trigger-conditions";

import { Icon } from "@web/components/Icon";
import { IconSizes, type IconName } from "@web/components/Icon/types";
import { readUnmetConditionKey } from "../../held-head";
import type { HeldCondition } from "../../held-head/types";
import { AnyGroupItem } from "../AnyGroupItem";
import { ConditionItem } from "../ConditionItem";
import type { HeldGroupHeadingLevel } from "../types";
import styles from "./ConditionGroup.module.scss";

export interface ConditionGroupProps {
  conditions: readonly HeldCondition[];
  headingLevel: HeldGroupHeadingLevel;
  icon: IconName;
  title: string;
}

/** One titled group of conditions; absent while it holds none. */
export function ConditionGroup({
  conditions,
  headingLevel: Heading,
  icon,
  title,
}: ConditionGroupProps) {
  const titleId = useId();
  if (conditions.length === 0) {
    return null;
  }

  return (
    <div className={styles["group"]}>
      <Heading className={styles["title"]} id={titleId}>
        <Icon name={icon} size={IconSizes.MD} />
        {title}
      </Heading>
      <ul aria-labelledby={titleId} className={styles["rows"]}>
        {conditions.map((condition) =>
          condition.kind === UnmetConditionKinds.ANY ? (
            <AnyGroupItem
              group={condition}
              key={readUnmetConditionKey(condition)}
            />
          ) : (
            <ConditionItem
              condition={condition}
              key={readUnmetConditionKey(condition)}
            />
          ),
        )}
      </ul>
    </div>
  );
}
