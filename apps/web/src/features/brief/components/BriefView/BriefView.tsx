import { useMemo, type ReactNode } from "react";

import type { ConversationPlan } from "@web/features/conversation";
import { MindMapProvider } from "@web/features/review/session";
import type { SubmitReviewAction } from "@web/features/review/submit";
import type { BriefSearchParams } from "../../comparison/compareState";
import type { RepoConfigContext } from "../../utils/repoConfig";
import type { Brief, LocalBriefSummary } from "../../types";
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
   * Read-only posture on a historical revision (BRIEF-24, ADR 0019 #6): the
   * comment composer and Submit disable with this reason (the submit route
   * pins commit_id to the viewed head — a historical submit would post against
   * a stale commit). Absent → the head is live and writable.
   */
  readOnly?: { reason: string } | undefined;
  /**
   * The `?thread=` landing target (BRIEF-24 reads it): opens the conversation
   * section and lands on that thread. Absent → no auto-open.
   */
  conversationFocusThreadId?: number | undefined;
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
  artifacts,
  brief,
  briefId,
  comparisonPlan,
  conversation,
  conversationFocusThreadId,
  headerControls,
  ownDraft,
  readOnly,
  repoConfig,
  searchParams,
  submitReview,
}: BriefViewProps) {
  const model = useMemo(
    () => buildBriefViewModel(brief, repoConfig),
    [brief, repoConfig],
  );
  return (
    <MindMapProvider briefId={briefId} model={model}>
      <BriefScreen
        artifacts={artifacts}
        brief={brief}
        repoConfig={repoConfig}
        briefId={briefId}
        comparisonPlan={comparisonPlan}
        conversation={conversation}
        conversationFocusThreadId={conversationFocusThreadId}
        headerControls={headerControls}
        model={model}
        ownDraft={ownDraft}
        readOnly={readOnly}
        searchParams={searchParams}
        submitReview={submitReview}
      />
    </MindMapProvider>
  );
}
