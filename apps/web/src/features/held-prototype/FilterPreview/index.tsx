// PROTOTYPE (BRIEF-381): where a held filter would sit, per direction.
import { useState } from "react";

import { Icon } from "@web/components/Icon";
import { IconNames, IconSizes } from "@web/components/Icon/types";

import { HELD_CASES } from "../model";
import { useHeldPrototype } from "../state";
import styles from "./FilterPreview.module.scss";

export function FilterPreview() {
  const { direction } = useHeldPrototype();
  const [on, setOn] = useState(false);
  const count = HELD_CASES.length;

  if (direction === "a") {
    return (
      <div className={styles["strip"]}>
        <button aria-pressed={on} className={styles["trigger"]} data-changed={on} type="button" onClick={() => setOn(!on)}>
          <span className={styles["name"]}>Status</span>
          <span className={styles["value"]}>{on ? "Held" : "Open, Draft"}</span>
          <Icon name={IconNames.CARET_DOWN} size={IconSizes.SM} />
        </button>
        <span className={styles["hint"]}>Held joins Status as a fifth choice</span>
      </div>
    );
  }
  if (direction === "b") {
    return (
      <div className={styles["strip"]} role="group" aria-label="View">
        <button aria-pressed={!on} className={styles["segment"]} type="button" onClick={() => setOn(false)}>
          All
        </button>
        <button aria-pressed={on} className={styles["segment"]} type="button" onClick={() => setOn(true)}>
          <Icon name={IconNames.HAND_PALM} size={IconSizes.SM} />
          Held <span className={styles["tally"]}>{count}</span>
        </button>
      </div>
    );
  }
  return (
    <div className={styles["strip"]}>
      <button aria-pressed={on} className={styles["pill"]} data-changed={on} type="button" onClick={() => setOn(!on)}>
        <Icon name={IconNames.HAND_PALM} size={IconSizes.SM} />
        {count} held
        {on ? <Icon name={IconNames.X} size={IconSizes.SM} /> : null}
      </button>
      <span className={styles["hint"]}>Shows only while a row is held</span>
    </div>
  );
}
