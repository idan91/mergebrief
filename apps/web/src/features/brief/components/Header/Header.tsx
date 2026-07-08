import { Link } from "@tanstack/react-router";
import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";

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
  // The header height is content-driven (title length, meta lines, viewport),
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

  return (
    <header className={styles["header"]} ref={headerRef}>
      <div className={styles["wordmark"]}>
        Brief<span> / review</span>
      </div>
      <div className={styles["prmeta"]}>
        <h1 className={styles["title"]}>{brief.pr.title}</h1>
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
        </div>
        {briefMetaLine(brief) ? (
          <div className={styles["sub"]}>{briefMetaLine(brief)}</div>
        ) : null}
      </div>
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
      <div className={styles["stats"]}>
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
      {openSummaryPreviewDrawer === undefined ? (
        <Link
          className="btn"
          params={{ briefId }}
          search={{ mode: reviewMode }}
          to="/briefs/$briefId/summary-preview"
        >
          Summary preview
        </Link>
      ) : (
        <button
          className="btn"
          type="button"
          onClick={openSummaryPreviewDrawer}
        >
          Summary preview
        </button>
      )}
      <button
        className={styles["clearDrafts"]}
        type="button"
        onClick={clearDrafts}
      >
        Clear local drafts
      </button>
      <div className={styles["progressBar"]} style={progressStyle} />
    </header>
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
