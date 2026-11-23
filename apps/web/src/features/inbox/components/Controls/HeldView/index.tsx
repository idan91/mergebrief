import { useTranslation } from "react-i18next";

import { SegmentedControl } from "@web/components/SegmentedControl";
import { HeldViewOptions, type HeldViewChoice } from "../types";
import styles from "./HeldView.module.scss";
import { useFocusWithin } from "./useFocusWithin";

export interface HeldViewProps {
  heldView: HeldViewChoice;
}

/**
 * All or only the held rows, the held ones counted. Native radios, so it
 * is one tab stop and the arrow keys move between the two. Shown while
 * offered; a poll that withdraws it while focus is inside leaves it in place,
 * focused, until focus moves elsewhere, so focus never drops to the body.
 */
export function HeldView({ heldView }: HeldViewProps) {
  const { t } = useTranslation();
  const { focusWithin, handleFocus, handleBlur } = useFocusWithin();
  const shown = heldView.offered || focusWithin;
  const options = [
    { value: HeldViewOptions.ALL, label: t("home.filters.heldViewAll") },
    {
      value: HeldViewOptions.HELD,
      label: t("home.filters.heldViewHeld"),
      count: heldView.count,
    },
  ];

  if (!shown) {
    return null;
  }

  return (
    <div className={styles["slot"]} onBlur={handleBlur} onFocus={handleFocus}>
      <SegmentedControl
        legend={t("home.filters.heldView")}
        name="inbox-held-view"
        options={options}
        value={heldView.value}
        onChange={heldView.onChoose}
      />
    </div>
  );
}
