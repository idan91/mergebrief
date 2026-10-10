// View/Compare controls for the DB brief route. Drives the SAME normalized
// search-state helpers as the local route's controls, so the two surfaces
// cannot drift semantically.
//
// Scope and comparison are one-of-N choices, so both are radio groups (SegmentedControl)
// rather than toggle-button rows: the browser then supplies group semantics,
// a single tab stop, and arrow-key movement.
import { useTranslation } from "react-i18next";
import {
  CompareParams,
  compareUnavailableTitle,
  isCompareAvailable,
  withCompare,
  withView,
  type BriefSearch,
  type CompareOptionFlags,
  type CompareParam,
  type ViewParam,
} from "@web/features/brief/model";
import {
  SegmentedControl,
  type SegmentedOption,
} from "@web/components/SegmentedControl";
import styles from "./DbCompareBar.module.scss";

export interface DbCompareBarProps {
  availability: CompareOptionFlags;
  compareState: BriefSearch;
  /**
   * Overrides the generic disabled title for "Your last review" with the
   * PR-meta reason copy (pending / baseline-unavailable). Only read when the
   * option is unavailable.
   */
  lastReviewDisabledReason?: string | undefined;
  /** Route-owned navigation, receives the next normalized View/Compare state. */
  onNavigate: (next: BriefSearch) => void;
}

export function DbCompareBar({
  availability,
  compareState,
  lastReviewDisabledReason,
  onNavigate,
}: DbCompareBarProps) {
  const { t } = useTranslation();
  const changesUnavailable =
    !availability.previousBrief && !availability.lastReview;

  const viewOptions: SegmentedOption<ViewParam>[] = [
    { value: "full", label: t("pulls.compare.fullBrief") },
    changesUnavailable
      ? {
          value: "changes",
          label: t("pulls.compare.changesOnly"),
          unavailableReason: t("pulls.compare.changesNeedsBaseline"),
        }
      : { value: "changes", label: t("pulls.compare.changesOnly") },
  ];

  const compareOption = (
    compare: Exclude<CompareParam, typeof CompareParams.OFF>,
    label: string,
  ): SegmentedOption<CompareParam> => {
    if (isCompareAvailable(compare, availability)) {
      return { value: compare, label };
    }
    const reason =
      (compare === CompareParams.LAST_REVIEW
        ? lastReviewDisabledReason
        : undefined) ?? compareUnavailableTitle(t, compare);
    return { value: compare, label, unavailableReason: reason };
  };

  const compareOptions: SegmentedOption<CompareParam>[] = [
    compareOption(CompareParams.LAST_REVIEW, t("pulls.compare.lastReview")),
    compareOption(
      CompareParams.PREVIOUS_BRIEF,
      t("pulls.compare.previousBrief"),
    ),
    compareState.view === "changes"
      ? {
          value: CompareParams.OFF,
          label: t("pulls.compare.off"),
          unavailableReason: t("pulls.compare.offOnlyFull"),
        }
      : { value: CompareParams.OFF, label: t("pulls.compare.off") },
  ];

  return (
    <nav aria-label={t("pulls.compare.navLabel")} className={styles["bar"]}>
      <SegmentedControl
        legend={t("pulls.compare.viewLegend")}
        name="db-brief-view"
        onChange={(view) => {
          onNavigate(withView(compareState, view, availability));
        }}
        options={viewOptions}
        value={compareState.view ?? "full"}
      />
      <SegmentedControl
        legend={t("pulls.compare.compareLegend")}
        name="db-brief-compare"
        onChange={(compare) => {
          onNavigate(withCompare(compareState, compare, availability));
        }}
        options={compareOptions}
        showLegend
        value={compareState.compare ?? CompareParams.OFF}
      />
    </nav>
  );
}
