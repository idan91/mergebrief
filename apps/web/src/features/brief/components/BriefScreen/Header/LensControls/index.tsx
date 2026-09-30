import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";

import {
  compareUnavailableTitle,
  isCompareAvailable,
  withCompare,
  withView,
  type BriefSearch,
  type CompareParam,
  type CompareOptionFlags,
  type ViewParam,
} from "../../../../comparison/compareState";
import {
  SegmentedControl,
  SegmentedDensities,
  type SegmentedOption,
} from "@web/components/SegmentedControl";
import styles from "./LensControls.module.scss";

export interface LensControlsProps {
  /** Compare availability at this brief. */
  availability: CompareOptionFlags;
  briefId: string;
  /** Resolved, normalized View/Compare state. */
  compareState: BriefSearch;
}

/**
 * The local route's View and Compare controls. They write canonical
 * `view`/`compare` params through `withView`/`withCompare`, so the URL only
 * ever holds a normalized, valid combination, and keep the link, whose
 * lines stay on the page.
 */
function keepLink(
  prev: { l?: string | undefined },
  next: BriefSearch,
): BriefSearch & { l?: string } {
  const kept: BriefSearch & { l?: string } = { ...next };
  if (prev.l !== undefined) {
    kept.l = prev.l;
  }

  return kept;
}

export function LensControls({
  availability,
  briefId,
  compareState,
}: LensControlsProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const selectView = (view: ViewParam) =>
    navigate({
      to: "/briefs/$briefId",
      params: { briefId },
      search: (prev) =>
        keepLink(prev, withView(compareState, view, availability)),
    });
  const compareOption = (
    compare: "last-review" | "previous-brief",
    label: string,
  ): SegmentedOption<CompareParam> =>
    isCompareAvailable(compare, availability)
      ? { value: compare, label }
      : {
          value: compare,
          label,
          unavailableReason: compareUnavailableTitle(t, compare),
        };
  const selectCompare = (compare: CompareParam) =>
    navigate({
      to: "/briefs/$briefId",
      params: { briefId },
      search: (prev) =>
        keepLink(prev, withCompare(compareState, compare, availability)),
    });

  const viewOptions: SegmentedOption<ViewParam>[] = [
    { value: "full", label: t("brief.timeline.fullBrief") },
    { value: "changes", label: t("brief.timeline.changesOnly") },
  ];
  const offOption: SegmentedOption<CompareParam> =
    compareState.view === "changes"
      ? {
          value: "off",
          label: t("brief.timeline.off"),
          unavailableReason: t("brief.timeline.offOnlyFull"),
        }
      : { value: "off", label: t("brief.timeline.off") };
  const compareOptions: SegmentedOption<CompareParam>[] = [
    compareOption("last-review", t("brief.timeline.lastReview")),
    compareOption("previous-brief", t("brief.timeline.previousBrief")),
    offOption,
  ];

  return (
    <div className={styles["lensRegion"]}>
      <SegmentedControl
        className={styles["lens"]}
        density={SegmentedDensities.ROOMY}
        legend={t("brief.timeline.viewLegend")}
        name="local-brief-view"
        onChange={selectView}
        options={viewOptions}
        value={compareState.view ?? "full"}
      />
      <SegmentedControl
        className={styles["labeledLens"]}
        density={SegmentedDensities.ROOMY}
        legend={t("brief.timeline.compareLegend")}
        name="local-brief-compare"
        onChange={selectCompare}
        options={compareOptions}
        showLegend
        value={compareState.compare ?? "off"}
      />
    </div>
  );
}
