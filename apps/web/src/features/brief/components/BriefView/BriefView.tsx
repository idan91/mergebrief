import { useMemo, type ReactNode } from "react";

import type { ConversationPlan } from "@web/features/conversation";
import type { ConversationFilter } from "@web/features/conversation/utils";
import {
  ReviewSessionProvider,
  type ReviewSessionPayload,
  type SessionWrites,
} from "@web/features/review/session";
import type { SubmitReviewAction } from "@web/features/review/utils";
import type { BriefSearchParams } from "../../comparison/compareState";
import type { RepoConfigContext } from "../../utils/repoConfig";
import type { Brief, LivePrState, LocalBriefSummary } from "../../types";
import { buildBriefViewModel } from "../../utils/viewModel";
import {
  BriefScreen,
  type BriefComparisonPlan,
  type OwnDraftPlan,
} from "../BriefScreen/BriefScreen";

export type {
  BriefComparisonPlan,
  OwnDraftPlan,
} from "../BriefScreen/BriefScreen";

// Optional props are the DB route's: the local file path wires none of them.
export interface BriefViewProps {
  livePrState?: LivePrState | undefined;
  artifacts?: LocalBriefSummary[] | undefined;
  briefId: string;
  /** DB route identity for in-app neighbour links; absent on the file path. */
  repoId?: string | undefined;
  searchParams: BriefSearchParams;
  brief: Brief;
  comparisonPlan?: BriefComparisonPlan;
  submitReview?: SubmitReviewAction;
  conversation?: ConversationPlan;
  /** Base drift: the rendered diff's base is not the PR's, so anchors can land wrong. */
  readOnly?: { reason: string } | undefined;
  /** Head drift: writable, but batch Submit requires an explicit ack. */
  staleHead?: boolean | undefined;
  openDeltaLens?: (() => void) | undefined;
  exitChangesScope?: (() => void) | undefined;
  /** Drops the `diff` deep link once the viewer picks a view; route-owned. */
  clearDiffParam?: (() => void) | undefined;
  conversationFocusThreadId?: number | undefined;
  conversationFilter?: ConversationFilter | undefined;
  onConversationFilterChange?: ((next: ConversationFilter) => void) | undefined;
  headerControls?: ReactNode | undefined;
  ownDraft?: OwnDraftPlan | undefined;
  /** Absent or null renders as if no repo config exists. */
  repoConfig?: RepoConfigContext | null | undefined;
  session?: ReviewSessionPayload | undefined;
  writes?: SessionWrites | undefined;
  /** The content region dims and goes inert; the header stays live. */
  revisionPending?: boolean | undefined;
}

/** One frozen default so the prop keeps its identity across renders. */
const NO_ARTIFACTS: LocalBriefSummary[] = [];

/** Empty `artifacts` self-disables every comparison affordance. */
export function BriefView({
  livePrState,
  artifacts = NO_ARTIFACTS,
  brief,
  briefId,
  repoId,
  comparisonPlan,
  conversation,
  conversationFocusThreadId,
  conversationFilter,
  onConversationFilterChange,
  headerControls,
  openDeltaLens,
  exitChangesScope,
  clearDiffParam,
  ownDraft,
  readOnly,
  repoConfig,
  revisionPending,
  searchParams,
  session,
  staleHead,
  submitReview,
  writes,
}: BriefViewProps) {
  const model = useMemo(
    () => buildBriefViewModel(brief, repoConfig),
    [brief, repoConfig],
  );
  return (
    <ReviewSessionProvider
      briefId={briefId}
      model={model}
      session={session}
      writes={writes}
    >
      <BriefScreen
        livePrState={livePrState}
        artifacts={artifacts}
        brief={brief}
        repoConfig={repoConfig}
        briefId={briefId}
        repoId={repoId}
        comparisonPlan={comparisonPlan}
        conversation={conversation}
        conversationFilter={conversationFilter}
        conversationFocusThreadId={conversationFocusThreadId}
        onConversationFilterChange={onConversationFilterChange}
        headerControls={headerControls}
        model={model}
        openDeltaLens={openDeltaLens}
        exitChangesScope={exitChangesScope}
        clearDiffParam={clearDiffParam}
        ownDraft={ownDraft}
        readOnly={readOnly}
        reviewSession={session}
        revisionPending={revisionPending}
        searchParams={searchParams}
        staleHead={staleHead}
        submitReview={submitReview}
      />
    </ReviewSessionProvider>
  );
}
