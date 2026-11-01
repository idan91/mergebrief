import { Icon } from "@web/components/Icon";
import { IconNames, IconSizes } from "@web/components/Icon/types";
import styles from "./OpenerBadge.module.scss";

/** The "open larger" mark an opener button shows while hovered or focused; it must be the button's direct child. */
export function OpenerBadge() {
  return (
    <span className={styles["badge"]}>
      <Icon name={IconNames.CORNERS_OUT} size={IconSizes.MD} />
    </span>
  );
}
