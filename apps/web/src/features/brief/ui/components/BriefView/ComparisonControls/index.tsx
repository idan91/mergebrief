import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";

import {
  compareUnavailableTitle,
  isCompareAvailable,
  withCompare,
  withView,
  type BriefSearch,
  type CompareOptionFlags,
  type ViewParam,
} from "../../../../model/comparison/compare-state";
import {
  CompareParams,
  type CompareParam,
} from "../../../../model/comparison/types";
import {
  SegmentedControl,
  SegmentedDensities,
  type SegmentedOption,
} from "@web/components/SegmentedControl";
import styles from "./ComparisonControls.module.scss";

export interface ComparisonControlsProps {
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

export function ComparisonControls({
  availability,
  briefId,
  compareState,
}: ComparisonControlsProps) {
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
    compare: Exclude<CompareParam, typeof CompareParams.OFF>,
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
          value: CompareParams.OFF,
          label: t("brief.timeline.off"),
          unavailableReason: t("brief.timeline.offOnlyFull"),
        }
      : { value: CompareParams.OFF, label: t("brief.timeline.off") };
  const compareOptions: SegmentedOption<CompareParam>[] = [
    compareOption(CompareParams.LAST_REVIEW, t("brief.timeline.lastReview")),
    compareOption(
      CompareParams.PREVIOUS_BRIEF,
      t("brief.timeline.previousBrief"),
    ),
    offOption,
  ];

  return (
    <div className={styles["comparisonRegion"]}>
      <SegmentedControl
        className={styles["scope"]}
        density={SegmentedDensities.ROOMY}
        legend={t("brief.timeline.viewLegend")}
        name="local-brief-view"
        onChange={selectView}
        options={viewOptions}
        value={compareState.view ?? "full"}
      />
      <SegmentedControl
        className={styles["labeledComparison"]}
        density={SegmentedDensities.ROOMY}
        legend={t("brief.timeline.compareLegend")}
        name="local-brief-compare"
        onChange={selectCompare}
        options={compareOptions}
        showLegend
        value={compareState.compare ?? CompareParams.OFF}
      />
    </div>
  );
}
