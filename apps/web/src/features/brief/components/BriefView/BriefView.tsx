import { useMemo, type ReactNode } from "react";

import type { ConversationPlan } from "@web/features/conversation";
import type { ConversationFilter } from "@web/features/conversation/utils/filter";
import { MindMapProvider } from "@web/features/review/session";
import type { SubmitReviewAction } from "@web/features/review/utils/submit";
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

export interface BriefViewProps {
  /**
   * Live webhook-maintained PR state (DB route, BRIEF-103): the header's
   * state badge prefers it over the artifact's stamped snapshot. Absent on
   * the local file path.
   */
  livePrState?: LivePrState | undefined;
  artifacts: LocalBriefSummary[];
  briefId: string;
  /** Raw View/Compare URL params (ADR 0024 plan step 6); undefined keys mean
   * "nothing chosen yet", resolved against comparison availability in BriefScreen's comparison overlay hook. */
  searchParams: BriefSearchParams;
  /** The already-fetched Brief to render (DB path: assembled client-side). */
  brief: Brief;
  comparisonPlan?: BriefComparisonPlan;
  /**
   * The DB route's submit transport (BRIEF-23). Absent on the local file
   * path — no GitHub identity there, Submit keeps its demo behavior.
   */
  submitReview?: SubmitReviewAction;
  /**
   * The DB route's live-conversation plan (BRIEF-25). Absent on the local
   * file path — no conversation section there.
   */
  conversation?: ConversationPlan;
  /**
   * Hard read-only posture (BRIEF-24, ADR 0019 #6 as amended by BRIEF-127:
   * base drift only): the comment composer and Submit disable with this
   * reason — the rendered diff's base is not the PR's, so anchors can land
   * wrong or nowhere. Absent → the span is writable.
   */
  readOnly?: { reason: string } | undefined;
  /**
   * The rendered span's head is not the PR head (BRIEF-127): writable, but
   * batch Submit requires the explicit ack in the SubmitModal.
   */
  staleHead?: boolean | undefined;
  /**
   * Opens the delta lens (BRIEF-102 since-marker link). Route-owned and
   * stable; absent where no navigation is wired (the local demo path).
   */
  openDeltaLens?: (() => void) | undefined;
  /**
   * The `?thread=` landing target (BRIEF-24 reads it): opens the conversation
   * section and lands on that thread. Absent → no auto-open.
   */
  conversationFocusThreadId?: number | undefined;
  /** Reviewer/verdict filter (BRIEF-99), carried in the URL by the route. */
  conversationFilter?: ConversationFilter | undefined;
  onConversationFilterChange?: ((next: ConversationFilter) => void) | undefined;
  /**
   * The DB route's unified revision/compare controls, rendered in the sticky
   * header's control slot (BRIEF-24 UX pass). Absent on the local path.
   */
  headerControls?: ReactNode | undefined;
  /** Own-draft state plan (BRIEF-43); absent on every plain reviewer view. */
  ownDraft?: OwnDraftPlan | undefined;
  /**
   * Repo-config snapshot for this span (BRIEF-52): attribute source markers,
   * de-emphasis weights, floor co-fire. Absent/null = render as if no repo
   * config exists (local path, pre-BRIEF-52 rows, failed context fetch).
   */
  repoConfig?: RepoConfigContext | null | undefined;
}

/**
 * Source-agnostic review screen (BRIEF-19 PR 3.2): the caller supplies the
 * Brief — local file store or the DB read API. `briefId` keys the per-brief
 * Mind-Map session store; `artifacts` feeds the LOCAL timeline/comparisons
 * and may be empty (every comparison affordance then self-disables).
 */
export function BriefView({
  livePrState,
  artifacts,
  brief,
  briefId,
  comparisonPlan,
  conversation,
  conversationFocusThreadId,
  conversationFilter,
  onConversationFilterChange,
  headerControls,
  openDeltaLens,
  ownDraft,
  readOnly,
  repoConfig,
  searchParams,
  staleHead,
  submitReview,
}: BriefViewProps) {
  const model = useMemo(
    () => buildBriefViewModel(brief, repoConfig),
    [brief, repoConfig],
  );
  return (
    <MindMapProvider briefId={briefId} model={model}>
      <BriefScreen
        livePrState={livePrState}
        artifacts={artifacts}
        brief={brief}
        repoConfig={repoConfig}
        briefId={briefId}
        comparisonPlan={comparisonPlan}
        conversation={conversation}
        conversationFilter={conversationFilter}
        conversationFocusThreadId={conversationFocusThreadId}
        onConversationFilterChange={onConversationFilterChange}
        headerControls={headerControls}
        model={model}
        openDeltaLens={openDeltaLens}
        ownDraft={ownDraft}
        readOnly={readOnly}
        searchParams={searchParams}
        staleHead={staleHead}
        submitReview={submitReview}
      />
    </MindMapProvider>
  );
}
