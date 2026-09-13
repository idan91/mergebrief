// The rendered-brief composition for the DB route. Data assembly (queries +
// live-diff attach) lives here; plan/transport assembly lives in the
// usePrBriefPlans hook.
import { useTranslation } from "react-i18next";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import { BriefView } from "@web/features/brief";
import { createSessionWrites } from "@web/features/review/session";
import {
  type BriefSearch,
  type BriefSearchParams,
  buildBriefSearchParams,
  resolveBriefSearch,
  withCompare,
  withView,
} from "@web/features/brief/comparison";
import type { ThreadRevisionJump } from "@web/features/conversation";
import type { Span } from "../../../utils/briefRouteState";
import { comparisonsWarming } from "../../../utils/briefRouteState";
import { attachLiveDiffs } from "../../../utils/liveDiff";
import type {
  DbTimelinePoint,
  DbTimelineSelection,
} from "../../../utils/dbTimeline";
import { usePrBriefPlans } from "../../../hooks/usePrBriefPlans";
import {
  dbBriefContextQueryOptions,
  dbBriefQueryOptions,
  prDiffQueryOptions,
  sessionQueryOptions,
} from "../../../queries";
import type { PrSummary } from "../../../types";
import { DbBriefControls } from "./DbBriefControls/DbBriefControls";
import { WarmingChip } from "../WarmingChip/WarmingChip";
import type { ConversationFilter } from "@web/features/conversation/utils";

export interface PrBriefContentProps {
  repoId: string;
  prNumber: number;
  span: Span;
  meta: PrSummary;
  searchParams: BriefSearchParams;
  onNavigateSearch: (next: BriefSearch) => void;
  /** Drops the `diff` deep link once the viewer picks a view; route-owned. */
  clearDiffParam?: (() => void) | undefined;
  readOnly?: { reason: string } | undefined;
  /** Head mismatch: writable, Submit gated by the receipt ack. */
  staleHead?: boolean | undefined;
  /** Present only when a newer briefed revision exists to move to. */
  onGoToNewest?: (() => void) | undefined;
  timeline?: DbTimelineSelection | undefined;
  onSelectRevision?: ((point: DbTimelinePoint) => void) | undefined;
  revisionJump?: ThreadRevisionJump | undefined;
  conversationFocusThreadId?: number | undefined;
  /** Reviewer/verdict filter carried in the URL. */
  conversationFilter?: ConversationFilter | undefined;
  onConversationFilterChange?: ((next: ConversationFilter) => void) | undefined;
  /** A revision navigation is in flight (router pending); route-owned. */
  revisionPending?: boolean | undefined;
}

export function PrBriefContent({
  repoId,
  prNumber,
  span,
  meta,
  searchParams,
  onNavigateSearch,
  clearDiffParam,
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
}: PrBriefContentProps) {
  const { t } = useTranslation();
  const brief = useSuspenseQuery(
    dbBriefQueryOptions(repoId, prNumber, span.base, span.head),
  ).data;
  // Best-effort: while loading or on failure the Brief renders without source
  // markers/de-emphasis.
  const repoConfig = useQuery(
    dbBriefContextQueryOptions(repoId, prNumber, span.base, span.head),
  );
  // The live diff arrives client-side and attaches per-chunk rows; while it
  // loads, chunks legally render without a diff (the renderer degrades).
  const diff = useQuery(
    prDiffQueryOptions(repoId, prNumber, span.base, span.head),
  );
  // The Review Session, prefetched by the route loader so the FIRST paint
  // already carries marks, drafts and dispositions. A failed read degrades:
  // the Brief renders, and the screen goes read-only, a reviewer typing into
  // a screen hiding their earlier drafts writes the same comment twice.
  const session = useQuery(
    sessionQueryOptions(repoId, prNumber, span.base, span.head),
  );
  // No session in hand = writes off, whether the read failed or has not
  // landed. A failed BACKGROUND refetch keeps the session that is already
  // rendered, only an absent one closes the screen.
  const sessionReadOnly =
    session.data === undefined
      ? { reason: t("brief.screen.sessionUnavailable") }
      : undefined;
  // One transport per span, so every store action fires exactly one
  // operation against the Brief it was read from.
  const writes = useMemo(
    () =>
      createSessionWrites({
        repoId,
        prNumber,
        base: span.base,
        head: span.head,
      }),
    [prNumber, repoId, span.base, span.head],
  );
  const assembled = useMemo(
    () => (diff.data === undefined ? brief : attachLiveDiffs(brief, diff.data)),
    [brief, diff.data],
  );
  const {
    briefId,
    comparisonPlan,
    availability,
    lastReviewDisabledReason,
    submitAction,
    conversationPlan,
    ownDraft,
  } = usePrBriefPlans({ repoId, prNumber, span, meta, timeline, revisionJump });
  const compareState = resolveBriefSearch(searchParams, availability);
  // Deps are PRIMITIVES: `availability` and `searchParams` are per-render
  // literals, and this callback rides into GroupCard's memo boundary, which
  // must survive PR-meta poll ticks.
  const searchView = searchParams.view;
  const searchCompare = searchParams.compare;
  const previousBriefAvailable = availability.previousBrief;
  const lastReviewAvailable = availability.lastReview;
  const openDeltaLens = useCallback(() => {
    const flags = {
      previousBrief: previousBriefAvailable,
      lastReview: lastReviewAvailable,
    };
    onNavigateSearch(
      withCompare(
        resolveBriefSearch(
          buildBriefSearchParams(searchView, searchCompare),
          flags,
        ),
        "last-review",
        flags,
      ),
    );
  }, [
    lastReviewAvailable,
    onNavigateSearch,
    previousBriefAvailable,
    searchCompare,
    searchView,
  ]);
  // Scope-axis exit for the IntentBar's jumps: the same normalized search
  // write the header View control makes, pinned to `full`.
  const exitChangesScope = useCallback(() => {
    const flags = {
      previousBrief: previousBriefAvailable,
      lastReview: lastReviewAvailable,
    };
    onNavigateSearch(
      withView(
        resolveBriefSearch(
          buildBriefSearchParams(searchView, searchCompare),
          flags,
        ),
        "full",
        flags,
      ),
    );
  }, [
    lastReviewAvailable,
    onNavigateSearch,
    previousBriefAvailable,
    searchCompare,
    searchView,
  ]);
  // Renders in the STICKY header's control slot so the controls are never
  // scrolled out of reach by the selection focus effect.
  const headerControls = (
    <DbBriefControls
      compare={{
        availability,
        compareState,
        lastReviewDisabledReason,
        onNavigate: onNavigateSearch,
      }}
      note={
        timeline?.degraded ? t("pulls.content.revisionLinkGone") : undefined
      }
      onSelectRevision={onSelectRevision}
      readOnly={(readOnly ?? sessionReadOnly) !== undefined}
      staleHead={staleHead}
      timeline={timeline}
      {...(onGoToNewest ? { onGoToNewest } : {})}
    />
  );
  return (
    <>
      {/* Warming is a property of the LATEST generation, never shown while a
          stale or read-only revision is in view (history never polls). */}
      {readOnly === undefined &&
      staleHead !== true &&
      comparisonsWarming(meta) ? (
        <WarmingChip />
      ) : null}
      <BriefView
        // Live webhook state, the badge never shows the artifact's stale
        // snapshot.
        livePrState={{ state: meta.state, draft: meta.draft }}
        brief={assembled}
        repoConfig={repoConfig.data ?? null}
        briefId={briefId}
        repoId={repoId}
        comparisonPlan={comparisonPlan}
        conversation={conversationPlan}
        conversationFilter={conversationFilter}
        onConversationFilterChange={onConversationFilterChange}
        conversationFocusThreadId={conversationFocusThreadId}
        headerControls={headerControls}
        openDeltaLens={openDeltaLens}
        exitChangesScope={exitChangesScope}
        clearDiffParam={clearDiffParam}
        ownDraft={ownDraft}
        readOnly={readOnly ?? sessionReadOnly}
        revisionPending={revisionPending}
        session={session.data}
        writes={session.data === undefined ? undefined : writes}
        searchParams={searchParams}
        staleHead={staleHead}
        submitReview={submitAction}
      />
    </>
  );
}
