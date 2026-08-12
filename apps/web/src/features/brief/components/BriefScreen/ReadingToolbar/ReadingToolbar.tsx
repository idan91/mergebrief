import { useTranslation } from "react-i18next";
import { useEffect, useRef } from "react";
import type { ValueOf } from "types";

import { useRevisionNavigation } from "../../../hooks/useRevisionNavigation";
import type { ComparisonOverlayState } from "../../../comparison/comparisonOverlay";
import type { AttributeRail } from "../../../utils/viewModel";
import {
  FilterDisclosure,
  type FilterDisclosureProps,
} from "./FilterDisclosure/FilterDisclosure";
import { RiskAttrsDisclosure } from "./RiskAttrsDisclosure/RiskAttrsDisclosure";
import styles from "./ReadingToolbar.module.scss";

/** The stepper only needs identity — never group content (no ranking cues). */
export interface GroupStepTarget {
  readonly id: string;
}

/** How many supporting chunks are collapsed; `some` = the mixed state. */
export const SupportingCollapseStates = {
  NONE: "none",
  SOME: "some",
  ALL: "all",
} as const;

export type SupportingCollapseState = ValueOf<typeof SupportingCollapseStates>;

const COLLAPSE_PRESSED: Record<SupportingCollapseState, boolean | "mixed"> = {
  none: false,
  some: "mixed",
  all: true,
};

export interface ReadingToolbarProps {
  /**
   * `full` = the Story bar; `filter-and-attrs` = the Concerns bar, which
   * carries Filter + Risk attrs only and targets chunks instead of groups.
   */
  variant: "full" | "filter-and-attrs";
  /**
   * The conversation filter's data + state. Absent (local path, facets not
   * yet resolved) = no filter surface at all.
   */
  filter?: FilterDisclosureProps | undefined;
  rail: AttributeRail;
  jumpToGroup: (groupId: string) => void;
  /** The Concerns variant's risk-attr target — chunks, not groups. */
  jumpToChunk: (chunkId: string) => void;
  /** Bulk status, never a lock — chunks stay individually expandable. */
  supportingCollapse: SupportingCollapseState;
  /** All collapsed → expand all; otherwise collapse all. */
  toggleCollapseSupporting: () => void;
  groups: readonly GroupStepTarget[];
  activeGroupId: string | null;
  comparison: ComparisonOverlayState;
}

/**
 * One sticky bar above the conversation slot, pinned below the header and
 * publishing its measured height as --toolbar-h so sticky chunk headers
 * stack beneath it. Two clusters split by auto-margin: left = what's shown,
 * right = where you are. The right cluster may be legitimately empty.
 */
export function ReadingToolbar({
  variant,
  filter,
  rail,
  jumpToGroup,
  jumpToChunk,
  supportingCollapse,
  toggleCollapseSupporting,
  groups,
  activeGroupId,
  comparison,
}: ReadingToolbarProps) {
  const { t } = useTranslation();
  const { jumpPrev, jumpNext } = useRevisionNavigation();
  const barRef = useRef<HTMLDivElement | null>(null);

  // Sticky chunk headers pin below the bar via the measured height; 0px
  // whenever the bar unmounts. The CSS-side fallback is 0px too — there is
  // no one honest static value, so a pre-hydration scroll pins chunk headers
  // barless until this effect publishes.
  useEffect(() => {
    const el = barRef.current;
    const setHeight = (value: string) =>
      document.documentElement.style.setProperty("--toolbar-h", value);
    if (!el) {
      setHeight("0px");
      return;
    }
    let lastHeight = "";
    const apply = () => {
      const next = `${el.offsetHeight}px`;
      if (next === lastHeight) return;
      lastHeight = next;
      setHeight(next);
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(el);
    return () => {
      observer.disconnect();
      setHeight("0px");
    };
  }, []);

  const activeGroupIndex = groups.findIndex(
    (group) => group.id === activeGroupId,
  );
  const stepGroup = (direction: 1 | -1) => {
    // Clamped, never wraps (matches read-through advance); no active group
    // yet → either direction lands on the first group.
    const target =
      activeGroupIndex === -1
        ? groups[0]
        : groups[
            Math.min(
              groups.length - 1,
              Math.max(0, activeGroupIndex + direction),
            )
          ];
    if (target) jumpToGroup(target.id);
  };

  return (
    <div
      className={styles["toolbar"]}
      data-testid="reading-toolbar"
      ref={barRef}
    >
      {filter !== undefined ? (
        <FilterDisclosure
          filter={filter.filter}
          hiddenInlineThreads={filter.hiddenInlineThreads}
          reviewers={filter.reviewers}
          verdicts={filter.verdicts}
          onChange={filter.onChange}
        />
      ) : null}
      {rail.entries.length > 0 ? (
        <RiskAttrsDisclosure
          rail={rail}
          targets={
            variant === "filter-and-attrs"
              ? { kind: "chunk", jump: jumpToChunk }
              : { kind: "group", jump: jumpToGroup }
          }
        />
      ) : null}
      {/* The Concerns bar ends here: collapse-supporting reads `role`, which
          ConcernView doesn't carry, and both position clusters are Story
          wayfinding. */}
      {variant === "filter-and-attrs" ? null : (
        <div className={styles["navCluster"]}>
          <button
            aria-pressed={COLLAPSE_PRESSED[supportingCollapse]}
            className={styles["tbtn"]}
            type="button"
            onClick={toggleCollapseSupporting}
          >
            {/* CSS swaps which label renders; the accessible name follows
                the visible one. */}
            <span className={styles["labelShort"]}>
              {t("brief.toolbar.collapseShort")}
            </span>
            <span className={styles["labelLong"]}>
              {t("brief.toolbar.collapseLong")}
            </span>
          </button>
          {groups.length > 0 ? (
            <span
              aria-label={t("brief.toolbar.ariaLabelGroupStepper")}
              className={styles["stepper"]}
              data-stepper="group"
              role="group"
            >
              <span className={styles["count"]}>
                {t("brief.toolbar.groupCount", {
                  current: activeGroupIndex === -1 ? "–" : activeGroupIndex + 1,
                  total: groups.length,
                })}
              </span>
              <button
                aria-label={t("brief.toolbar.ariaLabelPreviousGroup")}
                className={styles["stepBtn"]}
                type="button"
                onClick={() => stepGroup(-1)}
              >
                ◂
              </button>
              <button
                aria-label={t("brief.toolbar.ariaLabelNextGroup")}
                className={styles["stepBtn"]}
                type="button"
                onClick={() => stepGroup(1)}
              >
                ▸
              </button>
            </span>
          ) : null}
          {comparison.available && comparison.runCount > 0 ? (
            <span
              aria-label={
                comparison.compare === "last-review"
                  ? t("brief.toolbar.ariaLabelChangeStepperLastReview")
                  : t("brief.toolbar.ariaLabelChangeStepperRevision")
              }
              className={styles["stepper"]}
              role="group"
            >
              <span className={styles["count"]}>
                {t("brief.toolbar.changes", { count: comparison.runCount })}
              </span>
              <button
                aria-label={t("brief.toolbar.ariaLabelPreviousChange")}
                className={styles["stepBtn"]}
                type="button"
                onClick={jumpPrev}
              >
                ◂
              </button>
              <button
                aria-label={t("brief.toolbar.ariaLabelNextChange")}
                className={styles["stepBtn"]}
                type="button"
                onClick={jumpNext}
              >
                ▸
              </button>
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
}
