import { useMemo, type ReactNode } from "react";

import type { ConversationPlan } from "@web/features/conversation";
import type { ConversationFilter } from "@web/features/conversation/utils/filter";
import {
  ReviewSessionProvider,
  type ReviewSessionPayload,
  type SessionWrites,
} from "@web/features/review/session";
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
   * Live webhook-maintained PR state (DB route): the header's state badge
   * prefers it over the artifact's stamped snapshot. Absent on the local file
   * path.
   */
  livePrState?: LivePrState | undefined;
  artifacts: LocalBriefSummary[];
  briefId: string;
  /** Raw View/Compare URL params; undefined keys mean "nothing chosen yet",
   * resolved against comparison availability in BriefScreen's comparison
   * overlay hook. */
  searchParams: BriefSearchParams;
  /** The already-fetched Brief to render (DB path: assembled client-side). */
  brief: Brief;
  comparisonPlan?: BriefComparisonPlan;
  /**
   * The DB route's submit transport. Absent on the local file path — no
   * GitHub identity there, Submit keeps its demo behavior.
   */
  submitReview?: SubmitReviewAction;
  /**
   * The DB route's live-conversation plan. Absent on the local file path —
   * no conversation section there.
   */
  conversation?: ConversationPlan;
  /**
   * Hard read-only posture on base drift: the comment composer and Submit
   * disable with this reason — the rendered diff's base is not the PR's, so
   * anchors can land wrong or nowhere. Absent → the span is writable.
   */
  readOnly?: { reason: string } | undefined;
  /**
   * The rendered span's head is not the PR head: writable, but batch Submit
   * requires the explicit ack in the SubmitModal.
   */
  staleHead?: boolean | undefined;
  /**
   * Opens the delta lens from the since-marker link. Route-owned and stable;
   * absent where no navigation is wired (the local demo path).
   */
  openDeltaLens?: (() => void) | undefined;
  /**
   * Navigates the URL Scope axis back to `full`: the IntentBar's jumps route
   * through this from Changes scope. Route-owned; absent where no navigation
   * is wired.
   */
  exitChangesScope?: (() => void) | undefined;
  /**
   * The `?thread=` landing target: opens the conversation section and lands
   * on that thread. Absent → no auto-open.
   */
  conversationFocusThreadId?: number | undefined;
  /** Reviewer/verdict filter, carried in the URL by the route. */
  conversationFilter?: ConversationFilter | undefined;
  onConversationFilterChange?: ((next: ConversationFilter) => void) | undefined;
  /**
   * The DB route's unified revision/compare controls, rendered in the sticky
   * header's control slot. Absent on the local path.
   */
  headerControls?: ReactNode | undefined;
  /** Own-draft state plan; absent on every plain reviewer view. */
  ownDraft?: OwnDraftPlan | undefined;
  /**
   * Repo-config snapshot for this span: attribute source markers, de-emphasis
   * weights, floor co-fire. Absent/null = render as if no repo config exists
   * (local path, legacy rows, failed context fetch).
   */
  repoConfig?: RepoConfigContext | null | undefined;
  /**
   * The server-held Review Session, read by the route loader. Absent on the
   * file path (no session exists) and on a failed read, where the screen is
   * read-only.
   */
  session?: ReviewSessionPayload | undefined;
  /**
   * The session write transport, bound to this Brief's span. Absent on the
   * local path, where every action stays in the browser.
   */
  writes?: SessionWrites | undefined;
  /**
   * A revision navigation is in flight: the content region dims and goes
   * inert (delayed, so fast loads show nothing) while the header stays live.
   * Route-owned; absent = never pending.
   */
  revisionPending?: boolean | undefined;
}

/**
 * Source-agnostic review screen: the caller supplies the Brief — local file
 * store or the DB read API. `briefId` keys the per-brief Review Session
 * store; `artifacts` feeds the LOCAL timeline/comparisons and may be empty
 * (every comparison affordance then self-disables).
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
  exitChangesScope,
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
        comparisonPlan={comparisonPlan}
        conversation={conversation}
        conversationFilter={conversationFilter}
        conversationFocusThreadId={conversationFocusThreadId}
        onConversationFilterChange={onConversationFilterChange}
        headerControls={headerControls}
        model={model}
        openDeltaLens={openDeltaLens}
        exitChangesScope={exitChangesScope}
        ownDraft={ownDraft}
        readOnly={readOnly}
        revisionPending={revisionPending}
        searchParams={searchParams}
        staleHead={staleHead}
        submitReview={submitReview}
      />
    </ReviewSessionProvider>
  );
}
