// PROTOTYPE (BRIEF-381): one unmet condition, worded as the Entry words it.
import { Chip, ChipElements, ChipTones, ChipVariants } from "@web/components/Chip";
import { Icon } from "@web/components/Icon";
import { IconNames, IconSizes } from "@web/components/Icon/types";

import {
  type UnmetCondition,
  describeCondition,
  describeOwnerShort,
  isWait,
} from "../model";
import styles from "./ConditionLine.module.scss";

type Tone = "wait" | "failed" | "blocked" | "permission";

function readTone(condition: UnmetCondition): Tone {
  if (condition.kind === "bots" && condition.state === "permission") {
    return "permission";
  }
  if (condition.kind === "ci" && condition.permission === true) {
    return "permission";
  }
  if (isWait(condition)) {
    return "wait";
  }
  const failed =
    (condition.kind === "ci" && condition.failed.length > 0) ||
    (condition.kind === "bots" && condition.state === "issues");
  return failed ? "failed" : "blocked";
}

const GLYPHS = {
  wait: IconNames.HOURGLASS_MEDIUM,
  failed: IconNames.WARNING,
  blocked: IconNames.HAND_PALM,
  permission: IconNames.WARNING_DIAMOND,
} as const;

export interface ConditionLineProps {
  condition: UnmetCondition;
  /** Trim check names to three, as the Entry does. */
  capChecks?: boolean;
  showOwner?: boolean;
  showIcon?: boolean;
}

export function ConditionLine({
  condition,
  capChecks = false,
  showOwner = true,
  showIcon = true,
}: ConditionLineProps) {
  if (condition.kind === "any") {
    return (
      <li className={styles["line"]} data-icon={showIcon} data-tone="group">
        {showIcon ? (
          <span className={styles["icon"]}>
            <Icon name={IconNames.LIST_CHECKS} size={IconSizes.MD} />
          </span>
        ) : null}
        <span className={styles["body"]}>
          <span className={styles["text"]}>Needs one of these:</span>
          <ul className={styles["members"]}>
            {condition.conditions.map((member) => (
              <ConditionLine
                capChecks={capChecks}
                condition={member}
                key={`${member.kind}-${JSON.stringify(member)}`}
                showIcon={false}
                showOwner={showOwner}
              />
            ))}
          </ul>
        </span>
      </li>
    );
  }

  const tone = readTone(condition);
  const lines = describeCondition(condition, capChecks ? 3 : undefined);
  return (
    <li className={styles["line"]} data-icon={showIcon} data-tone={tone}>
      {showIcon ? (
        <span className={styles["icon"]}>
          <Icon name={GLYPHS[tone]} size={IconSizes.MD} />
        </span>
      ) : null}
      <span className={styles["body"]}>
        {lines.map((line) => (
          <span className={styles["text"]} key={line}>
            {line}
          </span>
        ))}
      </span>
      {showOwner ? (
        <Chip
          as={ChipElements.SPAN}
          className={styles["owner"]}
          tone={ChipTones.MUTED}
          variant={ChipVariants.FACT}
        >
          {describeOwnerShort(condition.source)}
        </Chip>
      ) : null}
    </li>
  );
}
