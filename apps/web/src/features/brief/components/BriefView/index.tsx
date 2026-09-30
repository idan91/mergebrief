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
import type { FileRowsCache } from "../../utils/fileRows";
import type { RepoConfigContext } from "../../utils/repoConfig";
import type {
  Brief,
  LivePrState,
  LocalBriefSummary,
  RevisionTimelinePlan,
} from "../../types";
import { buildBriefViewModel } from "../../utils/viewModel";
import {
  BriefScreen,
  type BriefComparisonPlan,
  type OwnDraftPlan,
  type ScopeExitOptions,
} from "../BriefScreen";

export type {
  BriefComparisonPlan,
  OwnDraftPlan,
  ScopeExitOptions,
} from "../BriefScreen";

// Optional props are the DB route's: the local file path wires none of them.
export interface BriefViewProps {
  livePrState?: LivePrState | undefined;
  artifacts?: LocalBriefSummary[] | undefined;
  briefId: string;
  /** DB route identity for in-app neighbour links; absent on the file path. */
  repoId?: string | undefined;
  searchParams: BriefSearchParams;
  brief: Brief;
  /** The PR diff's rows per file; absent leaves every hunk edge folded. */
  fileRows?: FileRowsCache | undefined;
  comparisonPlan?: BriefComparisonPlan;
  submitReview?: SubmitReviewAction;
  conversation?: ConversationPlan;
  /** Base drift: the rendered diff's base is not the PR's, so anchors can land wrong. */
  readOnly?: { reason: string } | undefined;
  /** Head drift: writable, but batch Submit requires an explicit ack. */
  staleHead?: boolean | undefined;
  openDeltaLens?: (() => void) | undefined;
  exitChangesScope?: ((options?: ScopeExitOptions) => void) | undefined;
  /** Drops the `diff` deep link once the viewer picks a view; route-owned. */
  clearDiffParam?: (() => void) | undefined;
  /** The link param the URL carries: a chunk, or lines, to land on. */
  link?: string | undefined;
  /** Writes or drops the link param with replace; route-owned. */
  navigateLink?: ((link: string | undefined) => void) | undefined;
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
  /** The PR's revisions for the Sidebar tab; route-owned. */
  revisions?: RevisionTimelinePlan | undefined;
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
  fileRows,
  headerControls,
  openDeltaLens,
  exitChangesScope,
  clearDiffParam,
  link,
  navigateLink,
  ownDraft,
  readOnly,
  repoConfig,
  revisionPending,
  revisions,
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
        fileRows={fileRows}
        headerControls={headerControls}
        model={model}
        openDeltaLens={openDeltaLens}
        exitChangesScope={exitChangesScope}
        clearDiffParam={clearDiffParam}
        link={link}
        navigateLink={navigateLink}
        ownDraft={ownDraft}
        readOnly={readOnly}
        reviewSession={session}
        revisionPending={revisionPending}
        revisions={revisions}
        searchParams={searchParams}
        staleHead={staleHead}
        submitReview={submitReview}
      />
    </ReviewSessionProvider>
  );
}
