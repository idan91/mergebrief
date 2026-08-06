import { useEffect, useRef } from "react";

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

export interface ReadingToolbarProps {
  /**
   * The legality table's toolbar cell (BRIEF-134 `deriveRegionBlocks`):
   * `full` = the Story bar; `filter-and-attrs` = the Concerns bar, which
   * carries Filter + Risk attrs only and targets chunks instead of groups.
   */
  variant: "full" | "filter-and-attrs";
  /**
   * The conversation filter's data + state (BRIEF-99, re-homed here by
   * BRIEF-134). Absent (local path, facets not yet resolved) = no filter
   * surface at all.
   */
  filter?: FilterDisclosureProps | undefined;
  rail: AttributeRail;
  jumpToGroup: (groupId: string) => void;
  /** The Concerns variant's risk-attr target (ADR 0032 #11: chunks there). */
  jumpToChunk: (chunkId: string) => void;
  collapseSupporting: boolean;
  setCollapseSupporting: (value: boolean) => void;
  groups: readonly GroupStepTarget[];
  activeGroupId: string | null;
  comparison: ComparisonOverlayState;
}

/**
 * The reading toolbar (BRIEF-134): one sticky bar above the conversation
 * slot, pinned below the header (FocusBanner pattern — publishes its
 * measured height as --toolbar-h so sticky chunk headers stack
 * beneath it). Two clusters split by auto-margin: left = what's shown
 * (Filter · Risk attrs · Collapse supporting), right = where you are
 * (group stepper <=1120px where the gutter TOC dies · changes nav while a
 * comparison is active). The right cluster may be legitimately empty.
 */
export function ReadingToolbar({
  variant,
  filter,
  rail,
  jumpToGroup,
  jumpToChunk,
  collapseSupporting,
  setCollapseSupporting,
  groups,
  activeGroupId,
  comparison,
}: ReadingToolbarProps) {
  const { jumpPrev, jumpNext } = useRevisionNavigation();
  const barRef = useRef<HTMLDivElement | null>(null);

  // FocusBanner pattern: sticky chunk headers pin below the bar via the
  // measured height; 0px whenever the bar unmounts (focus mode, changes view).
  // The CSS-side fallback is also 0px — deliberately: unlike --top-bar-h
  // there is no one honest static value (changes view/focus SSR has no bar),
  // so a pre-hydration scroll pins chunk headers barless until this effect
  // publishes; hydration corrects it in the same paint the bar gains height.
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
      {/* The Concerns bar ends here (legality table: Filter + Risk attrs
          only) — collapse-supporting reads `role`, which ConcernView doesn't
          carry, and both position clusters are Story wayfinding. */}
      {variant === "filter-and-attrs" ? null : (
        <div className={styles["navCluster"]}>
          {/* Owner amendment (2026-08-06): rides the right cluster beside
              the steppers, not the left filter cluster the spec drafted. */}
          <button
            aria-pressed={collapseSupporting}
            className={styles["tbtn"]}
            type="button"
            onClick={() => setCollapseSupporting(!collapseSupporting)}
          >
            {/* Compression ladder (spec'd, 1280): CSS swaps which label
                renders; the accessible name follows the visible one. */}
            <span className={styles["labelShort"]}>Collapse</span>
            <span className={styles["labelLong"]}>Collapse supporting</span>
          </button>
          {groups.length > 0 ? (
            <span
              aria-label="Step between change groups"
              className={styles["stepper"]}
              data-stepper="group"
              role="group"
            >
              <span className={styles["count"]}>
                Group {activeGroupIndex === -1 ? "–" : activeGroupIndex + 1}/
                {groups.length}
              </span>
              <button
                aria-label="Previous group"
                className={styles["stepBtn"]}
                type="button"
                onClick={() => stepGroup(-1)}
              >
                ◂
              </button>
              <button
                aria-label="Next group"
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
                  ? "Jump between changes since your last review"
                  : "Jump between changes in this revision"
              }
              className={styles["stepper"]}
              role="group"
            >
              <span className={styles["count"]}>
                {comparison.runCount} change
                {comparison.runCount === 1 ? "" : "s"}
              </span>
              <button
                aria-label="Previous change"
                className={styles["stepBtn"]}
                type="button"
                onClick={jumpPrev}
              >
                ◂
              </button>
              <button
                aria-label="Next change"
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
