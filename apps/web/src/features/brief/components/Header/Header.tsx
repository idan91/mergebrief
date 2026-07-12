import { Link } from "@tanstack/react-router";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import type { ReviewMode } from "../../../review/state";
import type { BriefSearch, CompareOptionFlags } from "../../compareState";
import type { ProgressTotals } from "../../progress";
import type { BriefTimeline } from "../../timeline";
import type { Brief } from "../../types";
import type { BriefViewModel } from "../../viewModel";
import { TimelineNavigator } from "../TimelineNavigator/TimelineNavigator";
import styles from "./Header.module.scss";

export type ViewMode = "story" | "concerns";
export type LayoutMode = "stacked" | "split";

export interface HeaderProps {
  brief: Brief;
  briefId: string;
  timeline: BriefTimeline;
  model: BriefViewModel;
  totals: ProgressTotals;
  progress: number;
  locOpen: boolean;
  reviewMode: ReviewMode;
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  setLocOpen: (value: boolean) => void;
  openReceipt: () => void;
  clearDrafts: () => void;
  /** Compare availability at the selected timeline point (ADR 0024). */
  availability: CompareOptionFlags;
  /** Resolved, normalized View/Compare state (ADR 0024 plan step 6). */
  compareState: BriefSearch;
  /**
   * DB-backed briefs (BRIEF-19) open the summary preview as the IN-PAGE
   * drawer via this callback: the standalone `/briefs/:id/summary-preview`
   * route loads through the local file store and cannot resolve a `db:` id.
   * Absent → the local cross-route link renders as before.
   */
  openSummaryPreviewDrawer?: (() => void) | undefined;
  /**
   * The DB route's unified revision/compare controls (BRIEF-24): rendered in
   * the local TimelineNavigator's slot so BOTH paths keep their controls in
   * the sticky header — discoverable and never scrolled out of reach.
   */
  controlsSlot?: ReactNode | undefined;
}

export function Header({
  brief,
  briefId,
  timeline,
  model,
  totals,
  progress,
  locOpen,
  reviewMode,
  viewMode,
  setViewMode,
  setLocOpen,
  openReceipt,
  clearDrafts,
  availability,
  compareState,
  openSummaryPreviewDrawer,
  controlsSlot,
}: HeaderProps) {
  const headerRef = useRef<HTMLElement>(null);
  // The header height is content-driven (title length, meta line, viewport),
  // so publish the measured height as --top-bar-h. Sticky chunk headers and the
  // progress bar pin to that, staying flush with the header's bottom edge.
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const apply = () =>
      document.documentElement.style.setProperty(
        "--top-bar-h",
        `${el.offsetHeight}px`,
      );
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const progressStyle: ProgressBarStyle = {
    "--progress-width": `${progress}%`,
  };
  const prLink = isHttpUrl(brief.pr.url) ? brief.pr.url : null;
  const meta = briefMetaLine(brief);

  return (
    <header className={styles["header"]} ref={headerRef}>
      {/* Tier 1 — identity and status: stable while reviewing. */}
      <div className={styles["identityRow"]}>
        <div className={styles["wordmark"]}>
          Brief<span> / review</span>
        </div>
        <div className={styles["prmeta"]}>
          <h1 className={styles["title"]}>{brief.pr.title}</h1>
          {/* One truncating context line: identity facts read left to right in
              falling order of stability (repo → PR → artifact → provenance). */}
          <div className={styles["sub"]}>
            <b>{brief.pr.repo}</b> ·{" "}
            {prLink ? (
              <a
                className={styles["ghlink"]}
                href={prLink}
                target="_blank"
                rel="noreferrer"
              >
                #{brief.pr.number} ↗
              </a>
            ) : (
              <span>#{brief.pr.number}</span>
            )}{" "}
            · {artifactHeaderLabel(brief)}
            {meta ? ` · ${meta}` : ""}
          </div>
        </div>
        {/* The three progress facts read as ONE object — hairline-divided
            cells instead of three floating text blocks. */}
        <div className={styles["statsGroup"]}>
          <button
            className={`stat ${styles["stat"]} ${styles["locBadge"]}`}
            data-state={locOpen ? "open" : "closed"}
            type="button"
            onClick={() => setLocOpen(!locOpen)}
          >
            <span>adjusted lines</span>
            <b>
              <span className="green">+{model.totalAdded}</span>{" "}
              <span className="faint">/</span>{" "}
              <span className="red">−{model.totalDeleted}</span>
            </b>
            <span className={styles["locPop"]}>
              <b>Adjusted ≈ git for this local brief.</b>
              <br />
              Move detection is not in the current categorizer output, so
              moved/generated exclusions are not claimed yet.
            </span>
          </button>
          <div className={`stat ${styles["stat"]}`}>
            chunks
            <b>
              {totals.reviewed}/{totals.chunkTotal}
            </b>
          </div>
          <div className={`stat ${styles["stat"]}`}>
            flags
            <b>
              {totals.flagsResolved}/{totals.flagTotal}
            </b>
          </div>
        </div>
        <button className="btn primary" type="button" onClick={openReceipt}>
          {reviewMode === "author" ? "Ready for review" : "Receipt"}
        </button>
        <HeaderMenu
          briefId={briefId}
          reviewMode={reviewMode}
          clearDrafts={clearDrafts}
          openSummaryPreviewDrawer={openSummaryPreviewDrawer}
        />
      </div>
      {/* Tier 2 — the lens toolbar: everything that changes WHAT is on
          screen (revision, View/Compare, Story/Concerns), flattened to one
          wrappable line. Story/Concerns organizes content rather than
          comparison, so it parks at the far end. */}
      <div className={styles["lensRow"]}>
        {controlsSlot !== undefined ? (
          controlsSlot
        ) : (
          <TimelineNavigator
            availability={availability}
            briefId={briefId}
            compareState={compareState}
            timeline={timeline}
          />
        )}
        <fieldset className={styles["viewbar"]}>
          <legend className="sr-only">Review view</legend>
          <label className={styles["viewOption"]}>
            <input
              checked={viewMode === "story"}
              className={styles["viewControl"]}
              name="review-view"
              type="radio"
              value="story"
              onChange={() => setViewMode("story")}
            />
            <span className={styles["viewLabel"]}>Story</span>
          </label>
          <label className={styles["viewOption"]}>
            <input
              checked={viewMode === "concerns"}
              className={styles["viewControl"]}
              name="review-view"
              type="radio"
              value="concerns"
              onChange={() => setViewMode("concerns")}
            />
            <span className={styles["viewLabel"]}>Concerns</span>
          </label>
        </fieldset>
      </div>
      {/* Decorative twin of the stats' numbers — hidden from the tree. */}
      <div
        aria-hidden="true"
        className={styles["progressBar"]}
        style={progressStyle}
      />
    </header>
  );
}

interface HeaderMenuProps {
  briefId: string;
  reviewMode: ReviewMode;
  clearDrafts: () => void;
  openSummaryPreviewDrawer?: (() => void) | undefined;
}

/**
 * Overflow for the header's rare actions (BRIEF-28): "Summary preview" and
 * "Clear local drafts" don't earn permanent top-level placement next to the
 * primary CTA. Standard menu-button semantics: Escape/outside-click close,
 * focus returns to the trigger, arrow keys move between items.
 */
function HeaderMenu({
  briefId,
  reviewMode,
  clearDrafts,
  openSummaryPreviewDrawer,
}: HeaderMenuProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  // Focus the first item when the menu opens (menu-button pattern).
  useEffect(() => {
    if (!open) return;
    wrapRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !wrapRef.current?.contains(event.target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const closeAndRefocus = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  // On the wrapper, not the popup: Escape must also work when focus sits on
  // the trigger with the menu open, and it must never leak to the page-level
  // shortcut listener (which binds Escape to exiting focus mode).
  const onWrapKeyDown = (event: KeyboardEvent) => {
    if (!open) return;
    event.stopPropagation();
    if (event.key === "Escape") {
      closeAndRefocus();
      return;
    }
    // APG menu-button: Tab closes the menu and moves focus onward — from
    // the trigger, not from a menuitem the close is about to unmount (which
    // would drop focus to <body> and restart tabbing at the document top).
    if (event.key === "Tab") {
      triggerRef.current?.focus();
      setOpen(false);
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const items = Array.from(
      wrapRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
    );
    if (items.length === 0) return;
    const active = document.activeElement;
    const current = active instanceof HTMLElement ? items.indexOf(active) : -1;
    const delta = event.key === "ArrowDown" ? 1 : -1;
    const next = (current + delta + items.length) % items.length;
    items[next]?.focus();
  };

  // No blur-based closer: Safari/Firefox-macOS don't focus buttons on
  // mousedown, so a click on a menuitem blurs the focused item first — a
  // blur handler would unmount the menu before the click lands. The
  // pointerdown-outside listener, Tab, and Escape cover every close path.

  return (
    // Coordination wrapper, not an interactive element itself: the handler
    // only closes/steers the menu; the interactive semantics live on the
    // trigger and the menuitems inside.
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div className={styles["menuWrap"]} ref={wrapRef} onKeyDown={onWrapKeyDown}>
      <button
        aria-controls={open ? menuId : undefined}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="More actions"
        className={styles["menuTrigger"]}
        ref={triggerRef}
        type="button"
        // Close via the refocus helper: WebKit/Firefox-macOS don't focus a
        // clicked button, so a plain toggle would unmount the focused
        // menuitem and drop focus to <body>.
        onClick={() => (open ? closeAndRefocus() : setOpen(true))}
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {open ? (
        <div
          className={styles["menu"]}
          id={menuId}
          role="menu"
          aria-label="More actions"
          tabIndex={-1}
        >
          {openSummaryPreviewDrawer === undefined ? (
            <Link
              className={styles["menuItem"]}
              params={{ briefId }}
              role="menuitem"
              search={{ mode: reviewMode }}
              tabIndex={0}
              to="/briefs/$briefId/summary-preview"
              onClick={() => setOpen(false)}
              // Anchors activate on Enter only; menuitem promises Space too.
              onKeyDown={(event) => {
                if (event.key === " ") {
                  event.preventDefault();
                  event.currentTarget.click();
                }
              }}
            >
              Summary preview
            </Link>
          ) : (
            <button
              className={styles["menuItem"]}
              role="menuitem"
              type="button"
              onClick={() => {
                // The drawer never claims focus, so return it to the
                // trigger — otherwise the unmounting menuitem drops it
                // on <body>.
                closeAndRefocus();
                openSummaryPreviewDrawer();
              }}
            >
              Summary preview
            </button>
          )}
          <button
            className={styles["menuItem"]}
            role="menuitem"
            type="button"
            onClick={() => {
              closeAndRefocus();
              clearDrafts();
            }}
          >
            Clear local drafts
          </button>
        </div>
      ) : null}
    </div>
  );
}

interface ProgressBarStyle extends CSSProperties {
  "--progress-width": string;
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function artifactHeaderLabel(brief: Brief): string {
  if (brief.artifactKind === "delta" && brief.baselineSha && brief.headSha) {
    return `local delta ${brief.baselineSha.slice(0, 7)} → ${brief.headSha.slice(0, 7)}`;
  }
  return `local brief @ ${brief.pr.sha.slice(0, 7)}`;
}

/** Muted index/commit-range + generation provenance, when present (ADR 0012/0013). */
function briefMetaLine(brief: Brief): string {
  const parts: string[] = [];
  if (brief.artifactKind === "brief" && brief.index != null) {
    const range = brief.commitRange
      ? ` · ${brief.commitRange.base.slice(0, 8)}..${brief.commitRange.head.slice(0, 8)}, ${brief.commitRange.commitCount} commit${brief.commitRange.commitCount === 1 ? "" : "s"}`
      : "";
    parts.push(`brief _${brief.index}${range}`);
  } else if (
    brief.artifactKind === "delta" &&
    (brief.baselineIndex != null || brief.headIndex != null)
  ) {
    const b =
      brief.baselineIndex != null
        ? `_${brief.baselineIndex}`
        : (brief.baselineSha?.slice(0, 8) ?? "?");
    const h =
      brief.headIndex != null
        ? `_${brief.headIndex}`
        : (brief.headSha?.slice(0, 8) ?? "?");
    parts.push(`${b} → ${h}`);
  }
  if (brief.generation) {
    const g = brief.generation;
    parts.push(
      `via ${g.provider}/${g.model}${g.effort ? ` · effort ${g.effort}` : ""}`,
    );
  }
  return parts.join(" · ");
}
