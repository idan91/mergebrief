import { useTranslation } from "react-i18next";

import { SegmentedControl } from "@web/components/SegmentedControl";
import { HeldViewOptions, type HeldViewChoice } from "../types";

export interface HeldViewProps {
  heldView: HeldViewChoice;
}

/**
 * All or only the held rows, the held ones counted. Native radios, so it
 * is one tab stop and the arrow keys move between the two.
 */
export function HeldView({ heldView }: HeldViewProps) {
  const { t } = useTranslation();
  const options = [
    { value: HeldViewOptions.ALL, label: t("home.filters.heldViewAll") },
    {
      value: HeldViewOptions.HELD,
      label: t("home.filters.heldViewHeld"),
      count: heldView.count,
    },
  ];

  return (
    <SegmentedControl
      legend={t("home.filters.heldView")}
      name="inbox-held-view"
      options={options}
      value={heldView.value}
      onChange={heldView.onChoose}
    />
  );
}
