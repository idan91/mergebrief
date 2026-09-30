import { useTranslation } from "react-i18next";
import { useEffect, useRef } from "react";
import type { ValueOf } from "types/utils";

import { IconButton } from "@web/components/IconButton";
import { ToolbarButton } from "@web/components/ToolbarButton";
import type { RevisionNavigation } from "../../../hooks/useRevisionNavigation";
import type { ComparisonOverlayState } from "../../../comparison/comparisonOverlay";
import type { AttributeRail } from "../../../utils/viewModel";
import {
  FilterDisclosure,
  type FilterDisclosureProps,
} from "./FilterDisclosure";
import { RiskAttrsDisclosure } from "./RiskAttrsDisclosure";
import { Icon } from "@web/components/Icon";
import {
  IconNames,
  IconRotations,
  IconSizes,
} from "@web/components/Icon/types";
import styles from "./ReadingToolbar.module.scss";

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
   * The conversation filter's data + state. Absent (local path, facets not
   * yet resolved) = no filter surface at all.
   */
  filter?: FilterDisclosureProps | undefined;
  rail: AttributeRail;
  jumpToGroup: (groupId: string) => void;
  /** Bulk status, never a lock; chunks stay individually expandable. */
  supportingCollapse: SupportingCollapseState;
  /** All collapsed → expand all; otherwise collapse all. */
  toggleCollapseSupporting: () => void;
  comparison: ComparisonOverlayState;
  /** Screen-owned: the jump needs the model target list and the window
   * registry, which live above this bar. */
  revisionNav: RevisionNavigation;
  /** Enters Read-through at step 1; absent while comparing or with no chunks. */
  startReadThrough?: (() => void) | undefined;
}

/**
 * One sticky bar above the conversation slot, pinned below the header and
 * publishing its measured height as --toolbar-h so sticky chunk headers
 * stack beneath it. Two clusters split by auto-margin: left = what's shown,
 * right = where you are. The right cluster may be legitimately empty.
 */
export function ReadingToolbar({
  filter,
  rail,
  jumpToGroup,
  supportingCollapse,
  toggleCollapseSupporting,
  comparison,
  revisionNav,
  startReadThrough,
}: ReadingToolbarProps) {
  const { t } = useTranslation();
  const { jumpPrev, jumpNext } = revisionNav;
  const barRef = useRef<HTMLDivElement | null>(null);

  // Sticky chunk headers pin below the bar via the measured height; 0px
  // whenever the bar unmounts. The CSS-side fallback is 0px too; there is
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
        <RiskAttrsDisclosure jumpToGroup={jumpToGroup} rail={rail} />
      ) : null}
      <div className={styles["navCluster"]}>
        {startReadThrough !== undefined ? (
          <ToolbarButton onClick={startReadThrough}>
            <span className={styles["labelShort"]}>
              {t("brief.toolbar.startReadThroughShort")}
            </span>
            <span className={styles["labelLong"]}>
              {t("brief.toolbar.startReadThrough")}
            </span>
          </ToolbarButton>
        ) : null}
        <ToolbarButton
          aria-pressed={COLLAPSE_PRESSED[supportingCollapse]}
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
        </ToolbarButton>
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
            <IconButton
              className={styles["stepBtn"]}
              label={t("brief.toolbar.ariaLabelPreviousChange")}
              onClick={jumpPrev}
            >
              <Icon
                name={IconNames.CARET_DOWN}
                rotation={IconRotations.QUARTER}
                size={IconSizes.MD}
              />
            </IconButton>
            <IconButton
              className={styles["stepBtn"]}
              label={t("brief.toolbar.ariaLabelNextChange")}
              onClick={jumpNext}
            >
              <Icon
                name={IconNames.CARET_DOWN}
                rotation={IconRotations.THREE_QUARTERS}
                size={IconSizes.MD}
              />
            </IconButton>
          </span>
        ) : null}
      </div>
    </div>
  );
}
