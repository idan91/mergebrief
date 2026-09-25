import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "@tanstack/react-router";

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
import type { BriefTimeline } from "../../../../utils/timeline";
import { TimelinePicker } from "@web/components/TimelinePicker";
import { Icon } from "@web/components/Icon";
import {
  IconNames,
  IconRotations,
  IconSizes,
} from "@web/components/Icon/types";
import styles from "./TimelineNavigator.module.scss";

export interface TimelineNavigatorProps {
  /** Compare availability at the selected timeline point. */
  availability: CompareOptionFlags;
  briefId: string;
  /** Resolved, normalized View/Compare state. */
  compareState: BriefSearch;
  timeline: BriefTimeline;
}

/**
 * Timeline points navigate Brief heads only. The View and Compare controls write
 * canonical `view`/`compare` params through `withView`/`withCompare`, so the URL
 * only ever holds a normalized, valid combination. Previous, Next and the
 * picker preserve the search verbatim and re-normalize against the new point.
 */
export function TimelineNavigator({
  availability,
  briefId,
  compareState,
  timeline,
}: TimelineNavigatorProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const selected = timeline.selectedPoint;
  const currentIndex = selected
    ? timeline.points.findIndex((point) => point.briefId === selected.briefId)
    : -1;
  const previous =
    currentIndex > 0 ? timeline.points[currentIndex - 1] : undefined;
  const next =
    currentIndex >= 0 ? timeline.points[currentIndex + 1] : undefined;

  const selectView = (view: ViewParam) =>
    navigate({
      to: "/briefs/$briefId",
      params: { briefId },
      search: withView(compareState, view, availability),
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
      search: withCompare(compareState, compare, availability),
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

  const pointOptions = timeline.points.map((point) => ({
    value: point.briefId,
    label: t("brief.timeline.briefOptionSha", {
      index: point.index,
      sha: point.headSha.slice(0, 7),
      total: timeline.points.length,
    }),
  }));
  const selectPoint = (targetBriefId: string) =>
    navigate({
      to: "/briefs/$briefId",
      params: { briefId: targetBriefId },
      search: (prev) => prev,
    });

  if (!selected) return null;
  return (
    <>
      <nav
        className={styles["timeline"]}
        aria-label={t("brief.timeline.ariaLabelNav")}
      >
        <span aria-live="polite" className="sr-only">
          {t("brief.timeline.viewingBrief", {
            index: selected.index,
            total: timeline.points.length,
          })}
        </span>
        {previous ? (
          <Link
            aria-label={t("brief.timeline.ariaLabelPreviousBrief", {
              index: previous.index,
            })}
            className={styles["arrow"]}
            params={{ briefId: previous.briefId }}
            search={(prev) => prev}
            to="/briefs/$briefId"
          >
            <Icon
              name={IconNames.ARROW_UP}
              rotation={IconRotations.THREE_QUARTERS}
              size={IconSizes.MD}
            />
          </Link>
        ) : (
          <span
            aria-hidden="true"
            className={styles["arrow"]}
            data-state="disabled"
          >
            <Icon
              name={IconNames.ARROW_UP}
              rotation={IconRotations.THREE_QUARTERS}
              size={IconSizes.MD}
            />
          </span>
        )}
        <TimelinePicker
          label={t("brief.timeline.selectLabel")}
          options={pointOptions}
          value={selected.briefId}
          onValueChange={selectPoint}
        />
        {next ? (
          <Link
            aria-label={t("brief.timeline.ariaLabelNextBrief", {
              index: next.index,
            })}
            className={styles["arrow"]}
            params={{ briefId: next.briefId }}
            search={(prev) => prev}
            to="/briefs/$briefId"
          >
            <Icon
              name={IconNames.ARROW_UP}
              rotation={IconRotations.QUARTER}
              size={IconSizes.MD}
            />
          </Link>
        ) : (
          <span
            aria-hidden="true"
            className={styles["arrow"]}
            data-state="disabled"
          >
            <Icon
              name={IconNames.ARROW_UP}
              rotation={IconRotations.QUARTER}
              size={IconSizes.MD}
            />
          </span>
        )}
      </nav>
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
    </>
  );
}
