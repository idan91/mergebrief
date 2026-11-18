import { useTranslation } from "react-i18next";

import { useHandedOffFocus } from "../hooks/useHandedOffFocus";
import styles from "./SpendRefused.module.scss";

export interface SpendRefusedProps {
  focusHandedOff: boolean;
  onFocusTaken: () => void;
}

/** The viewer is no longer an Operator; nothing on this page can lift that. */
export function SpendRefused({
  focusHandedOff,
  onFocusTaken,
}: SpendRefusedProps) {
  const { t } = useTranslation();
  const headingRef = useHandedOffFocus(focusHandedOff, onFocusTaken);

  return (
    <div className={styles["root"]}>
      <h2 ref={headingRef} className={styles["heading"]} tabIndex={-1}>
        {t("spend.refusedHeading")}
      </h2>
      <p className={styles["detail"]}>{t("spend.operatorOnly")}</p>
    </div>
  );
}
