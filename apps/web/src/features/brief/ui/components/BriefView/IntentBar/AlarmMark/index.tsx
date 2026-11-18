import { Icon } from "@web/components/Icon";
import { IconNames, IconSizes } from "@web/components/Icon/types";
import styles from "./AlarmMark.module.scss";

export interface AlarmMarkProps {
  /** Set only where no caution line beside the mark already says what it means. */
  label?: string;
}

/**
 * Marks an alarm bucket, right of its label. A shape, never a colour: the
 * code-risk palette would make an epistemic caution read as a severity.
 */
export function AlarmMark({ label }: AlarmMarkProps) {
  return (
    <Icon
      className={styles["mark"]}
      label={label}
      name={IconNames.WARNING_DIAMOND}
      size={IconSizes.MD}
    />
  );
}
