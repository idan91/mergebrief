// The DB-brief route's body: one polite live region announcing state swaps
// and revision selection, then the state switch. All state cards are
// presentational; the announcement is owned here.
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import type { BriefAddressPort } from "@web/features/brief";
import type { BriefSearchParams } from "@web/features/brief/model";
import type { ThreadRevisionJump } from "@web/features/conversation";
import type { ConversationFilter } from "@web/features/conversation/utils";
import type { deriveBriefRouteState } from "../../../utils/briefRouteState";
import { comparisonsWarming } from "../../../utils/briefRouteState";
import type {
  DbTimelinePoint,
  DbTimelineSelection,
} from "../../../utils/dbTimeline";
import { awaitsReadyForReview } from "../../../utils/draft-policy";
import { isNoLongerOpen, readSupersededStop } from "../../../utils/pr-state";
import { draftPolicyNotice } from "../../../utils/ownDraft";
import type { PrSummary } from "../../../types";
import { AwaitingTriggerCard } from "../AwaitingTriggerCard";
import { CappedCard } from "../CappedCard";
import { buildCappedLabel } from "../capped-head";
import { EmptyCard } from "../EmptyCard";
import { FailedCard } from "../FailedCard";
import { PrBriefContent } from "../PrBriefContent";
import { SupersededCard } from "../SupersededCard";
import { WaitCard } from "../WaitCard";
import { waitLabel } from "../waiting-head";
import { readEmptyCopyOverride, readSupersededAnnouncementKey } from "./utils";

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
    case "awaiting-trigger":
      return isNoLongerOpen(meta.state)
        ? t("pulls.announce.awaitingTriggerNotOpen")
        : t("pulls.announce.awaitingTrigger");
    case "superseded":
      return t(readSupersededAnnouncementKey(meta));
    case "capped":
      return buildCappedLabel(t, state);
    case "empty":
      return readEmptyCopyOverride(t, meta) ?? t("pulls.announce.noBrief");
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
  /** Session writes stay open; posting to GitHub is off. */
  postingDisabled?: { reason: string } | undefined;
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
  postingDisabled,
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
  const heldForReady = awaitsReadyForReview(meta);
  const supersededStop = readSupersededStop(meta);
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
          postingDisabled={postingDisabled}
          readOnly={readOnly}
          repoId={repoId}
          revisionJump={revisionJump}
          revisionPending={revisionPending}
          searchParams={searchParams}
          span={state.span}
          staleHead={staleHead}
          onGoToNewest={onGoToNewest}
          timeline={timeline}
        />
      );
    case "waiting":
      return (
        <main className="main" id="main-content" tabIndex={-1}>
          <WaitCard
            parts={state.parts}
            phase={state.phase}
            prNumber={prNumber}
            pendingNotice={
              policyNotice?.kind === "damped" ? policyNotice.text : undefined
            }
            repoId={repoId}
            rerun={{
              prState: meta.state,
              appInstalled: meta.appInstalled,
              awaitsReadyForReview: heldForReady,
            }}
            span={state.span}
            startedAt={state.startedAt}
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
            appInstalled={meta.appInstalled}
            awaitsReadyForReview={heldForReady}
            errorCode={state.errorCode}
            errorDetail={state.errorDetail}
            prNumber={prNumber}
            prState={meta.state}
            repoId={repoId}
            viewerCanPush={meta.viewerCanPush}
          />
        </main>
      );
    case "awaiting-trigger":
      return (
        <main className="main" id="main-content" tabIndex={-1}>
          <AwaitingTriggerCard
            appInstalled={meta.appInstalled}
            awaitsReadyForReview={heldForReady}
            prNumber={prNumber}
            prState={meta.state}
            repoId={repoId}
            viewerCanPush={meta.viewerCanPush}
          />
        </main>
      );
    case "superseded":
      return (
        <main className="main" id="main-content" tabIndex={-1}>
          <SupersededCard stop={supersededStop} />
        </main>
      );
    case "capped":
      return (
        <main className="main" id="main-content" tabIndex={-1}>
          <CappedCard
            appInstalled={meta.appInstalled}
            awaitsReadyForReview={heldForReady}
            cappedAt={state.cappedAt}
            prState={meta.state}
            units={state.units}
          />
        </main>
      );
    case "empty":
      return (
        <main className="main" id="main-content" tabIndex={-1}>
          <EmptyCard copyOverride={readEmptyCopyOverride(t, meta)} />
        </main>
      );
  }
}

export function PrBriefBody(props: PrBriefBodyProps) {
  const { state, meta, timeline, readOnly, staleHead } = props;
  const { t } = useTranslation();
  const announcesRevision = timeline !== undefined && state.kind === "render";
  const announcement = announcesRevision
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
