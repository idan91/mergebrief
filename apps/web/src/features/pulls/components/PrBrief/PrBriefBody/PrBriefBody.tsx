// The DB-brief route's body: one polite live region announcing state swaps
// and revision selection (ADR 0019 #7), then the state switch — render,
// wait, failed, superseded, empty. All state cards are presentational; the
// announcement is owned here.
import type {
  BriefSearch,
  BriefSearchParams,
} from "../../../../brief/comparison/compareState";
import type { ThreadRevisionJump } from "@web/features/conversation";
import type { deriveBriefRouteState } from "../../../utils/briefRouteState";
import { comparisonsWarming } from "../../../utils/briefRouteState";
import type {
  DbTimelinePoint,
  DbTimelineSelection,
} from "../../../utils/dbTimeline";
import { draftPolicyNotice } from "../../../utils/ownDraft";
import type { PrSummary } from "../../../types";
import { EmptyCard } from "../EmptyCard/EmptyCard";
import { FailedCard } from "../FailedCard/FailedCard";
import { PrBriefContent } from "../PrBriefContent/PrBriefContent";
import { SupersededCard } from "../SupersededCard/SupersededCard";
import { WaitCard, waitLabel } from "../WaitCard/WaitCard";

type BriefRouteState = ReturnType<typeof deriveBriefRouteState>;

/** The BRIEF-64 policy notice for this meta (null for non-authors/defaults). */
function metaPolicyNotice(meta: PrSummary) {
  return draftPolicyNotice(meta.draftPolicy, meta);
}

/** The polite revision-selection announcement (ADR 0019 #7 a11y contract). */
export function timelineAnnouncement(
  timeline: DbTimelineSelection,
  writable: boolean,
): string {
  if (timeline.degraded) {
    return "That revision is unavailable. Showing the latest brief.";
  }
  const position = `Viewing revision ${timeline.selected.headIndex} of ${timeline.points.length}`;
  return writable ? `${position}.` : `${position}. Read-only.`;
}

export function stateAnnouncement(
  state: BriefRouteState,
  meta: PrSummary,
): string {
  const notice = metaPolicyNotice(meta);
  switch (state.kind) {
    case "render":
      return comparisonsWarming(meta)
        ? "Brief ready. Comparisons are still warming."
        : "Brief ready.";
    case "waiting":
      return waitLabel(
        state.status,
        state.phase,
        notice?.kind === "damped" ? notice.text : undefined,
      );
    case "failed":
      return "Brief generation failed.";
    case "superseded":
      return "A newer revision is on the way.";
    case "empty":
      return notice?.kind === "drafts-off"
        ? notice.text
        : "No brief for this pull request yet.";
  }
}

export interface PrBriefBodyProps {
  repoId: string;
  prNumber: number;
  meta: PrSummary;
  state: BriefRouteState;
  searchParams: BriefSearchParams;
  onNavigateSearch: (next: BriefSearch) => void;
  /** Read-only posture + reason on a historical head (BRIEF-24, ADR 0019 #6). */
  readOnly?: { reason: string } | undefined;
  /** The resolved revision timeline (BRIEF-24); absent on legacy metas. */
  timeline?: DbTimelineSelection | undefined;
  onSelectRevision?: ((point: DbTimelinePoint) => void) | undefined;
  /** Outdated-thread revision jump (BRIEF-24); absent when there is no timeline. */
  revisionJump?: ThreadRevisionJump | undefined;
  /** `?thread=` landing target (BRIEF-24 reads it). */
  conversationFocusThreadId?: number | undefined;
}

function PrBriefBodyState({
  repoId,
  prNumber,
  meta,
  state,
  searchParams,
  onNavigateSearch,
  readOnly,
  timeline,
  onSelectRevision,
  revisionJump,
  conversationFocusThreadId,
}: PrBriefBodyProps) {
  const policyNotice = metaPolicyNotice(meta);
  switch (state.kind) {
    case "render":
      return (
        <PrBriefContent
          conversationFocusThreadId={conversationFocusThreadId}
          meta={meta}
          onNavigateSearch={onNavigateSearch}
          onSelectRevision={onSelectRevision}
          prNumber={prNumber}
          readOnly={readOnly}
          repoId={repoId}
          revisionJump={revisionJump}
          searchParams={searchParams}
          span={state.span}
          timeline={timeline}
        />
      );
    case "waiting":
      return (
        <main className="main" id="main-content" tabIndex={-1}>
          <WaitCard
            phase={state.phase}
            prNumber={prNumber}
            queuedNotice={
              policyNotice?.kind === "damped" ? policyNotice.text : undefined
            }
            repoId={repoId}
            span={state.span}
            status={state.status}
          />
        </main>
      );
    case "failed":
      return (
        <main className="main" id="main-content" tabIndex={-1}>
          <FailedCard attempts={state.attempts} error={state.error} />
        </main>
      );
    case "superseded":
      return (
        <main className="main" id="main-content" tabIndex={-1}>
          <SupersededCard />
        </main>
      );
    case "empty":
      return (
        <main className="main" id="main-content" tabIndex={-1}>
          <EmptyCard
            copyOverride={
              policyNotice?.kind === "drafts-off"
                ? policyNotice.text
                : undefined
            }
          />
        </main>
      );
  }
}

export function PrBriefBody(props: PrBriefBodyProps) {
  const { state, meta, timeline, readOnly } = props;
  const announcement = timeline
    ? timelineAnnouncement(timeline, readOnly === undefined)
    : stateAnnouncement(state, meta);
  return (
    <>
      {/* One PERSISTENT live region ahead of the switch: state swaps update
          its text in place — a per-branch region would remount and never be
          announced. */}
      <span
        aria-atomic="true"
        aria-live="polite"
        className="sr-only"
        role="status"
      >
        {announcement}
      </span>
      <PrBriefBodyState {...props} />
    </>
  );
}
