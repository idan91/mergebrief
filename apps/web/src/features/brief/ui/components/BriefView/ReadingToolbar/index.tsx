import { useTranslation } from "react-i18next";
import { useEffect, useRef } from "react";

import { ToolbarButton } from "@web/components/ToolbarButton";
import type { RevisionNavigation } from "../../../hooks/useRevisionNavigation";
import type { ComparisonOverlayState } from "../../../../model/comparison/comparison-overlay";
import type { RiskAttrCycle } from "../hooks/useRiskAttrCycle";
import type { AttributeRail } from "../../../../model/utils/view-model";
import {
  FilterDisclosure,
  type FilterDisclosureProps,
} from "../FilterDisclosure";
import { RiskAttrsDisclosure } from "../RiskAttrsDisclosure";
import { ChangeStepper } from "../ChangeStepper";
import { COLLAPSE_PRESSED } from "../consts";
import type { SupportingCollapseState } from "../types";
import styles from "./ReadingToolbar.module.scss";

export interface ReadingToolbarProps {
  /**
   * The conversation filter's data + state. Absent (local path, facets not
   * yet resolved) = no filter surface at all.
   */
  filter?: FilterDisclosureProps | undefined;
  rail: AttributeRail;
  jumpToGroup: (groupId: string) => void;
  riskAttrCycle: RiskAttrCycle;
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
  riskAttrCycle,
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
      if (next === lastHeight) {
        return;
      }
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
        <RiskAttrsDisclosure
          cycle={riskAttrCycle}
          jumpToGroup={jumpToGroup}
          rail={rail}
        />
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
        <ChangeStepper
          comparison={comparison}
          jumpNext={jumpNext}
          jumpPrev={jumpPrev}
        />
      </div>
    </div>
  );
}
