// The rendered-brief composition for the DB route. Data assembly (queries +
// live-diff attach) lives here; plan/transport assembly lives in the
// usePrBriefPlans hook.
import { useTranslation } from "react-i18next";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import { BriefView } from "@web/features/brief";
import type {
  BriefSearch,
  BriefSearchParams,
} from "../../../../brief/comparison/compareState";
import {
  resolveBriefSearch,
  withCompare,
  withView,
} from "../../../../brief/comparison/compareState";
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
} from "../../../queries";
import type { PrSummary } from "../../../types";
import { DbBriefControls } from "./DbBriefControls/DbBriefControls";
import { WarmingChip } from "../WarmingChip/WarmingChip";
import type { ConversationFilter } from "@web/features/conversation/utils/filter";

export interface PrBriefContentProps {
  repoId: string;
  prNumber: number;
  span: Span;
  meta: PrSummary;
  searchParams: BriefSearchParams;
  onNavigateSearch: (next: BriefSearch) => void;
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
}

export function PrBriefContent({
  repoId,
  prNumber,
  span,
  meta,
  searchParams,
  onNavigateSearch,
  readOnly,
  staleHead,
  onGoToNewest,
  timeline,
  onSelectRevision,
  revisionJump,
  conversationFocusThreadId,
  conversationFilter,
  onConversationFilterChange,
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
          {
            ...(searchView !== undefined ? { view: searchView } : {}),
            ...(searchCompare !== undefined ? { compare: searchCompare } : {}),
          },
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
          {
            ...(searchView !== undefined ? { view: searchView } : {}),
            ...(searchCompare !== undefined ? { compare: searchCompare } : {}),
          },
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
      readOnly={readOnly !== undefined}
      staleHead={staleHead}
      timeline={timeline}
      {...(onGoToNewest ? { onGoToNewest } : {})}
    />
  );
  return (
    <>
      {/* Warming is a property of the LATEST generation — never shown while a
          stale or read-only revision is in view (history never polls). */}
      {readOnly === undefined &&
      staleHead !== true &&
      comparisonsWarming(meta) ? (
        <WarmingChip />
      ) : null}
      <BriefView
        // Live webhook state — the badge never shows the artifact's stale
        // snapshot.
        livePrState={{ state: meta.state, draft: meta.draft }}
        artifacts={[]}
        brief={assembled}
        repoConfig={repoConfig.data ?? null}
        briefId={briefId}
        comparisonPlan={comparisonPlan}
        conversation={conversationPlan}
        conversationFilter={conversationFilter}
        onConversationFilterChange={onConversationFilterChange}
        conversationFocusThreadId={conversationFocusThreadId}
        headerControls={headerControls}
        key={briefId}
        openDeltaLens={openDeltaLens}
        exitChangesScope={exitChangesScope}
        ownDraft={ownDraft}
        readOnly={readOnly}
        searchParams={searchParams}
        staleHead={staleHead}
        submitReview={submitAction}
      />
    </>
  );
}
