// The DB-brief route's body: one polite live region announcing state swaps
// and revision selection, then the state switch. All state cards are
// presentational; the announcement is owned here.
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import type { BriefAddressPort } from "@web/features/brief";
import type { BriefSearchParams } from "@web/features/brief/comparison";
import type { ThreadRevisionJump } from "@web/features/conversation";
import type { ConversationFilter } from "@web/features/conversation/utils";
import type { deriveBriefRouteState } from "../../../utils/briefRouteState";
import { comparisonsWarming } from "../../../utils/briefRouteState";
import type {
  DbTimelinePoint,
  DbTimelineSelection,
} from "../../../utils/dbTimeline";
import { draftPolicyNotice } from "../../../utils/ownDraft";
import type { PrSummary } from "../../../types";
import { CappedCard } from "../CappedCard";
import { cappedLabel } from "../CappedCard/utils";
import { EmptyCard } from "../EmptyCard";
import { FailedCard } from "../FailedCard";
import { PrBriefContent } from "../PrBriefContent";
import { SupersededCard } from "../SupersededCard";
import { WaitCard, waitLabel } from "../WaitCard";

type BriefRouteState = ReturnType<typeof deriveBriefRouteState>;

/** The draft-policy notice for this meta (null for non-authors/defaults). */
function metaPolicyNotice(t: TFunction, meta: PrSummary) {
  return draftPolicyNotice(t, meta.draftPolicy, meta);
}

/** The polite revision-selection announcement. */
export function timelineAnnouncement(
  t: TFunction,
  timeline: DbTimelineSelection,
  writable: boolean,
): string {
  if (timeline.degraded) {
    return t("pulls.announce.revisionDegraded");
  }
  const params = {
    index: timeline.selected.headIndex,
    total: timeline.points.length,
  };
  return writable
    ? t("pulls.announce.viewingRevision", params)
    : t("pulls.announce.viewingRevisionReadOnly", params);
}

export function stateAnnouncement(
  t: TFunction,
  state: BriefRouteState,
  meta: PrSummary,
  staleHead = false,
): string {
  const notice = metaPolicyNotice(t, meta);
  switch (state.kind) {
    case "render":
      // Warming is a property of the LATEST generation, on a stale span the
      // chip is suppressed (PrBriefContent), so the announcement matches.
      return comparisonsWarming(meta) && !staleHead
        ? t("pulls.announce.briefReadyWarming")
        : t("pulls.announce.briefReady");
    case "waiting":
      return waitLabel(t, {
        status: state.status,
        phase: state.phase,
        waitReason: state.waitReason,
        pendingNotice: notice?.kind === "damped" ? notice.text : undefined,
      });
    case "failed":
      return t("pulls.announce.failed");
    case "superseded":
      return t("pulls.announce.superseded");
    case "capped":
      return cappedLabel(t, state.cappedAt);
    case "empty":
      return notice?.kind === "drafts-off"
        ? notice.text
        : t("pulls.announce.noBrief");
  }
}

export interface PrBriefBodyProps {
  repoId: string;
  prNumber: number;
  meta: PrSummary;
  state: BriefRouteState;
  searchParams: BriefSearchParams;
  /** The route's URL writes. */
  address: BriefAddressPort;
  /** Hard read-only posture + reason (base drift only). */
  readOnly?: { reason: string } | undefined;
  /**
   * The rendered span's head is not the PR head: writable, but Submit
   * requires the stale ack in the receipt.
   */
  staleHead?: boolean | undefined;
  /** Present only when a newer briefed revision exists to move to. */
  onGoToNewest?: (() => void) | undefined;
  /** The resolved revision timeline; absent on legacy metas. */
  timeline?: DbTimelineSelection | undefined;
  onSelectRevision?: ((point: DbTimelinePoint) => void) | undefined;
  /** Outdated-thread revision jump; absent when there is no timeline. */
  revisionJump?: ThreadRevisionJump | undefined;
  /** `?thread=` landing target. */
  conversationFocusThreadId?: number | undefined;
  /** Reviewer/verdict filter carried in the URL. */
  conversationFilter?: ConversationFilter | undefined;
  onConversationFilterChange: (next: ConversationFilter) => void;
  /** A revision navigation is in flight (router pending); route-owned. */
  revisionPending?: boolean | undefined;
}

function PrBriefBodyState({
  repoId,
  prNumber,
  meta,
  state,
  searchParams,
  address,
  readOnly,
  staleHead,
  onGoToNewest,
  timeline,
  onSelectRevision,
  revisionJump,
  conversationFocusThreadId,
  conversationFilter,
  onConversationFilterChange,
  revisionPending,
}: PrBriefBodyProps) {
  const { t } = useTranslation();
  const policyNotice = metaPolicyNotice(t, meta);
  switch (state.kind) {
    case "render":
      return (
        <PrBriefContent
          conversationFilter={conversationFilter}
          conversationFocusThreadId={conversationFocusThreadId}
          onConversationFilterChange={onConversationFilterChange}
          meta={meta}
          address={address}
          onSelectRevision={onSelectRevision}
          prNumber={prNumber}
          readOnly={readOnly}
          repoId={repoId}
          revisionJump={revisionJump}
          revisionPending={revisionPending}
          searchParams={searchParams}
          span={state.span}
          staleHead={staleHead}
          {...(onGoToNewest ? { onGoToNewest } : {})}
          timeline={timeline}
        />
      );
    case "waiting":
      return (
        <main className="main" id="main-content" tabIndex={-1}>
          <WaitCard
            phase={state.phase}
            prNumber={prNumber}
            pendingNotice={
              policyNotice?.kind === "damped" ? policyNotice.text : undefined
            }
            repoId={repoId}
            span={state.span}
            status={state.status}
            waitReason={state.waitReason}
          />
        </main>
      );
    case "failed":
      return (
        <main className="main" id="main-content" tabIndex={-1}>
          <FailedCard
            attempts={state.attempts}
            errorCode={state.errorCode}
            errorDetail={state.errorDetail}
          />
        </main>
      );
    case "superseded":
      return (
        <main className="main" id="main-content" tabIndex={-1}>
          <SupersededCard />
        </main>
      );
    case "capped":
      return (
        <main className="main" id="main-content" tabIndex={-1}>
          <CappedCard cappedAt={state.cappedAt} />
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
  const { state, meta, timeline, readOnly, staleHead } = props;
  const { t } = useTranslation();
  const announcement = timeline
    ? timelineAnnouncement(t, timeline, readOnly === undefined)
    : stateAnnouncement(t, state, meta, staleHead === true);
  return (
    <>
      {/* One PERSISTENT live region ahead of the switch: state swaps update
          its text in place. A per-branch region would remount and never be
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
