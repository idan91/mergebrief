import { Link } from "@tanstack/react-router";

import type { ReviewMode } from "../../../review/state";
import type { ProgressTotals } from "../../progress";
import type { BriefTimeline } from "../../timeline";
import type { Brief } from "../../types";
import type { BriefViewModel } from "../../viewModel";
import { TimelineNavigator } from "../TimelineNavigator/TimelineNavigator";

export interface HeaderProps {
  brief: Brief;
  briefId: string;
  timeline: BriefTimeline;
  model: BriefViewModel;
  totals: ProgressTotals;
  progress: number;
  locOpen: boolean;
  reviewMode: ReviewMode;
  setLocOpen: (value: boolean) => void;
  openReceipt: () => void;
  clearDrafts: () => void;
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
  setLocOpen,
  openReceipt,
  clearDrafts,
}: HeaderProps) {
  return (
    <header>
      <div className="wordmark">
        Brief<span> / review</span>
      </div>
      <div className="prmeta">
        <div className="title">{brief.pr.title}</div>
        <div className="sub">
          <b>{brief.pr.repo}</b> ·{" "}
          <a
            className="ghlink"
            href={brief.pr.url}
            target="_blank"
            rel="noreferrer"
          >
            #{brief.pr.number} ↗
          </a>{" "}
          · {artifactHeaderLabel(brief)}
        </div>
        {briefMetaLine(brief) ? (
          <div className="sub faint">{briefMetaLine(brief)}</div>
        ) : null}
      </div>
      <TimelineNavigator briefId={briefId} timeline={timeline} />
      <div className="hdr-stats">
        <button
          className={locOpen ? "stat loc-badge open" : "stat loc-badge"}
          type="button"
          onClick={() => setLocOpen(!locOpen)}
        >
          <span className="statlabel">adjusted lines</span>
          <b>
            <span className="green">+{model.totalAdded}</span>{" "}
            <span className="faint">/</span>{" "}
            <span className="red">−{model.totalDeleted}</span>
          </b>
          <span className="loc-pop">
            <b>Adjusted ≈ git for this local brief.</b>
            <br />
            Move detection is not in the current categorizer output, so
            moved/generated exclusions are not claimed yet.
          </span>
        </button>
        <div className="stat">
          chunks
          <b>
            {totals.reviewed}/{totals.chunkTotal}
          </b>
        </div>
        <div className="stat">
          flags
          <b>
            {totals.flagsResolved}/{totals.flagTotal}
          </b>
        </div>
      </div>
      <button className="btn primary" type="button" onClick={openReceipt}>
        {reviewMode === "author" ? "Ready for review" : "Receipt"}
      </button>
      <Link
        className="btn"
        params={{ briefId }}
        search={{ mode: reviewMode }}
        to="/briefs/$briefId/summary-preview"
      >
        Summary preview
      </Link>
      <button className="clear-drafts" type="button" onClick={clearDrafts}>
        Clear local drafts
      </button>
      <div className="progress-bar" style={{ width: `${progress}%` }} />
    </header>
  );
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
