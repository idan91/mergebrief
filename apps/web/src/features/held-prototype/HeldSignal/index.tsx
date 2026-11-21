// PROTOTYPE (BRIEF-381): the inbox row's right edge for a held head.
import { Icon } from "@web/components/Icon";
import { IconNames } from "@web/components/Icon/types";

import {
  type HeldCase,
  describeConditionShort,
  isWait,
  sortConditions,
} from "../model";
import { useHeldPrototype } from "../state";
import styles from "./HeldSignal.module.scss";

export interface HeldSignalProps {
  held: HeldCase;
}

export function HeldSignal({ held }: HeldSignalProps) {
  const { direction } = useHeldPrototype();
  const sorted = sortConditions(held.unmet);
  const allWaits = held.unmet.every(isWait);
  const more = sorted.length - 1;

  if (direction === "a") {
    const lead = sorted.find((condition) => !isWait(condition)) ?? sorted[0];
    const firstShort = lead === undefined ? "" : describeConditionShort(lead);
    return (
      <span className={styles["signal"]} data-direction="a" data-wait={allWaits}>
        <Icon name={allWaits ? IconNames.HOURGLASS_MEDIUM : IconNames.HAND_PALM} />
        <span className={styles["label"]}>{firstShort}</span>
        {more > 0 ? <span className={styles["more"]}>+{more}</span> : null}
      </span>
    );
  }
  if (direction === "b") {
    return (
      <span className={styles["signal"]} data-direction="b" data-wait={allWaits}>
        <Icon name={allWaits ? IconNames.HOURGLASS_MEDIUM : IconNames.HAND_PALM} />
        <span className={styles["label"]}>{allWaits ? "Waiting" : "Held"}</span>
      </span>
    );
  }
  return (
    <span className={styles["signal"]} data-direction="c" data-wait={allWaits}>
      <Icon name={IconNames.HAND_PALM} />
      <span className={styles["label"]}>Held</span>
      <span className={styles["count"]}>{held.unmet.length}</span>
    </span>
  );
}

export interface HeldRowNoteProps {
  held: HeldCase;
}

/** Direction B only: the first reason rides the row's second line. */
export function HeldRowNote({ held }: HeldRowNoteProps) {
  const { direction } = useHeldPrototype();
  if (direction !== "b") {
    return null;
  }
  const sorted = sortConditions(held.unmet);
  const first = sorted.find((condition) => !isWait(condition)) ?? sorted[0];
  if (first === undefined) {
    return null;
  }
  const more = sorted.length - 1;
  return (
    <span className={styles["note"]}>
      {describeConditionShort(first)}
      {more > 0 ? `, ${String(more)} more` : ""}
    </span>
  );
}
