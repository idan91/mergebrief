// The rendered-brief composition for the DB route (role naming: this is the
// CONTENT of a renderable PR brief, whatever its source span). Data assembly
// (queries + live-diff attach) lives here; plan/transport assembly lives in
// the usePrBriefPlans hook.
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { BriefView } from "@web/features/brief";
import type {
  BriefSearch,
  BriefSearchParams,
} from "../../../../brief/comparison/compareState";
import { resolveBriefSearch } from "../../../../brief/comparison/compareState";
import type { ThreadRevisionJump } from "@web/features/conversation";
import type { Span } from "../../../briefRouteState";
import { comparisonsWarming } from "../../../briefRouteState";
import { attachLiveDiffs } from "../../../liveDiff";
import type { DbTimelinePoint, DbTimelineSelection } from "../../../dbTimeline";
import { usePrBriefPlans } from "../../../hooks/usePrBriefPlans";
import {
  dbBriefContextQueryOptions,
  dbBriefQueryOptions,
  prDiffQueryOptions,
} from "../../../queries";
import type { PrSummary } from "../../../types";
import { DbBriefControls } from "../../DbBriefControls/DbBriefControls";
import { WarmingChip } from "../WarmingChip/WarmingChip";

export interface PrBriefContentProps {
  repoId: string;
  prNumber: number;
  span: Span;
  meta: PrSummary;
  searchParams: BriefSearchParams;
  onNavigateSearch: (next: BriefSearch) => void;
  readOnly?: { reason: string } | undefined;
  timeline?: DbTimelineSelection | undefined;
  onSelectRevision?: ((point: DbTimelinePoint) => void) | undefined;
  revisionJump?: ThreadRevisionJump | undefined;
  conversationFocusThreadId?: number | undefined;
}

export function PrBriefContent({
  repoId,
  prNumber,
  span,
  meta,
  searchParams,
  onNavigateSearch,
  readOnly,
  timeline,
  onSelectRevision,
  revisionJump,
  conversationFocusThreadId,
}: PrBriefContentProps) {
  const brief = useSuspenseQuery(
    dbBriefQueryOptions(repoId, prNumber, span.base, span.head),
  ).data;
  // Repo-config snapshot (BRIEF-52): best-effort — while loading or on
  // failure the Brief renders without source markers/de-emphasis.
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
  // The unified control surface (BRIEF-24 UX pass): revision navigator +
  // View/Compare lenses render in the STICKY header's control slot — always
  // discoverable, never scrolled out of reach by the selection focus effect.
  const headerControls = (
    <DbBriefControls
      compare={{
        availability,
        compareState,
        lastReviewDisabledReason,
        onNavigate: onNavigateSearch,
      }}
      note={
        timeline?.degraded
          ? "That revision link is no longer available — showing the latest brief."
          : undefined
      }
      onSelectRevision={onSelectRevision}
      readOnly={readOnly !== undefined}
      timeline={timeline}
    />
  );
  return (
    <>
      {/* Warming is a property of the LATEST generation — never shown while a
          historical (read-only) revision is in view (history never polls). */}
      {readOnly === undefined && comparisonsWarming(meta) ? (
        <WarmingChip />
      ) : null}
      <BriefView
        artifacts={[]}
        brief={assembled}
        repoConfig={repoConfig.data ?? null}
        briefId={briefId}
        comparisonPlan={comparisonPlan}
        conversation={conversationPlan}
        conversationFocusThreadId={conversationFocusThreadId}
        headerControls={headerControls}
        key={briefId}
        ownDraft={ownDraft}
        readOnly={readOnly}
        searchParams={searchParams}
        submitReview={submitAction}
      />
    </>
  );
}
