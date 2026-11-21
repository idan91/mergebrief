// The held panel's foot: the every-push checkbox, what it does, and its
// outcome line. Presentational; the card's facade owns the write.
import { useId } from "react";
import { useTranslation } from "react-i18next";

import { Checkbox } from "@web/components/Checkbox";
import { handOffFocusOnRemoval } from "../../../../utils/focus-hand-off";
import styles from "./EveryPushSwitch.module.scss";

export interface EveryPushSwitchProps {
  checked: boolean;
  /** The outcome line; its region stays mounted so each change is read. */
  announcement: string;
  onChange: (next: boolean) => void;
}

export function EveryPushSwitch({
  checked,
  announcement,
  onChange,
}: EveryPushSwitchProps) {
  const { t } = useTranslation();
  const hintId = useId();

  return (
    <footer
      className={styles["foot"]}
      data-testid="held-every-push"
      ref={handOffFocusOnRemoval}
    >
      <Checkbox checked={checked} describedBy={hintId} onChange={onChange}>
        {t("pulls.everyPush.label")}
      </Checkbox>
      <p className={styles["hint"]} id={hintId}>
        {t("pulls.everyPush.hint")}
      </p>
      <p
        aria-atomic="true"
        aria-live="polite"
        className={styles["outcome"]}
        role="status"
      >
        {announcement}
      </p>
    </footer>
  );
}
