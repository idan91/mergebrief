// PROTOTYPE (BRIEF-381): a stored brief is on screen and the newest head is
// held. Rides the Header's revision row where the newer-commits chip sits.
import { useState } from "react";

import { Button, ButtonSizes, ButtonVariants } from "@web/components/Button";
import { Icon } from "@web/components/Icon";
import { IconNames, IconSizes } from "@web/components/Icon/types";
import { Popover } from "@web/components/Popover";

import { ConditionLine } from "../ConditionLine";
import { type HeldCase, composeSentence, describeConditionShort, sortConditions } from "../model";
import { useHeldPrototype } from "../state";
import styles from "./HeldBehindChip.module.scss";

export interface HeldBehindChipProps {
  held: HeldCase;
}

export function HeldBehindChip({ held }: HeldBehindChipProps) {
  const { direction } = useHeldPrototype();
  const [queued, setQueued] = useState(false);
  const sorted = sortConditions(held.unmet);
  const first = sorted[0];
  const reason = first === undefined ? "" : describeConditionShort(first);

  const labels = {
    a: "Newest push held",
    b: `Newest push: ${reason.toLowerCase()}`,
    c: composeSentence(held.unmet).lead.replace("Generates a brief", "Newest push generates").replace(/\.$/, ""),
  } as const;

  return (
    <Popover placement="bottom-start">
      <Popover.Trigger>
        <button className={styles["chip"]} data-direction={direction} type="button">
          <Icon name={IconNames.HOURGLASS_MEDIUM} size={IconSizes.SM} />
          <span className={styles["label"]}>{labels[direction]}</span>
          <Icon name={IconNames.CARET_DOWN} size={IconSizes.SM} />
        </button>
      </Popover.Trigger>
      <Popover.Content className={styles["panel"]} label="Newest push">
        <p className={styles["title"]}>
          This brief is for <code>{held.previousSha}</code>. The newest push,{" "}
          <code>{held.sha}</code>, is held.
        </p>
        <ul className={styles["list"]}>
          {sorted.map((condition) => (
            <ConditionLine condition={condition} key={JSON.stringify(condition)} />
          ))}
        </ul>
        <div className={styles["actions"]}>
          <Button
            size={ButtonSizes.SM}
            variant={ButtonVariants.SECONDARY}
            onClick={() => setQueued(true)}
          >
            {queued ? "Queued" : "Generate for the newest push"}
          </Button>
        </div>
      </Popover.Content>
    </Popover>
  );
}
