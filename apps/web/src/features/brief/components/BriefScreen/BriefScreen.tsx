import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useStore } from "zustand";

import type { CommentAnchor } from "@web/features/review/utils/comments";
import {
  ConversationSection,
  type ConversationPlan,
} from "@web/features/conversation";
import { SubmitModal } from "@web/features/review";
import type { SubmitReviewAction } from "@web/features/review/utils/submit";
import { useReviewSubmit } from "@web/features/review/hooks/useReviewSubmit";
import {
  clearSnapshots,
  deriveInitialState,
  ReviewFlowProvider,
  useCreateReviewFlowStore,
  useSyncReviewFlowPosture,
} from "@web/features/review/session";
import type { UnresolvedItem } from "@web/features/review/utils/state";
import type { BriefSearchParams } from "../../comparison/compareState";
import type { MarkReadyAction } from "@web/features/pulls/transport/markReady";
import {
  useInFlightPosts,
  type PostCommentResult,
} from "@web/features/pulls/transport/postComment";
// Direct component import, not the pulls barrel: the barrel now exports the
// PrBrief tree, which renders BriefView — importing it from here would close
// a brief -> pulls -> brief module cycle.
import { MarkReadyModal } from "@web/features/pulls/components/MarkReadyModal/MarkReadyModal";
import type { Brief, LivePrState, LocalBriefSummary } from "../../types";
import { useKeyboardShortcuts } from "../../hooks/useKeyboardShortcuts";
import type { buildBriefViewModel } from "../../utils/viewModel";
import { buildAttributeRail } from "../../utils/viewModel";
import type { RepoConfigContext } from "../../utils/repoConfig";
import { ChangesOnlyView } from "./ChangesOnlyView/ChangesOnlyView";
import { ConcernView } from "./ConcernView/ConcernView";
import { AttributeJumpRail } from "./AttributeJumpRail/AttributeJumpRail";
import { FocusBanner } from "./FocusBanner/FocusBanner";
import { IntentBar, type IntentBarHandle } from "./IntentBar/IntentBar";
import { GroupTocBar } from "./GroupTocBar/GroupTocBar";
import { Header } from "./Header/Header";
import { RiskFlagModals } from "./RiskFlagModals/RiskFlagModals";
import { ShortcutsModal } from "./ShortcutsModal/ShortcutsModal";
import { StoryView } from "./StoryView/StoryView";
import { SummaryPreviewDrawer } from "./SummaryPreviewDrawer/SummaryPreviewDrawer";
import { SummarySection } from "./SummarySection/SummarySection";
import {
  useComparisonOverlay,
  type BriefComparisonPlan,
} from "./useComparisonOverlay";
import { useConversationWiring } from "./useConversationWiring";
import { useMarkReadyFlow } from "./useMarkReadyFlow";
import { POST_COMMENT_COPY, useOwnDraftFlow } from "./useOwnDraftFlow";
import { useReadingSession } from "./useReadingSession";
import styles from "./BriefScreen.module.scss";

export type { BriefComparisonPlan } from "./useComparisonOverlay";
// The door for the copy constants: tests live outside this subtree and may
// not reach into the hook files directly (ADR 0037 §2).
export { markReadyBatchFailureCopy } from "./utils";
import { groupSinceMarkers } from "./utils";
export { POST_COMMENT_COPY } from "./useOwnDraftFlow";

/**
 * Own-draft composer block on a stale view (BRIEF-127 preserves BRIEF-43):
 * post-now exists only at the current head, so a stale-staged draft would
 * have no exit — unlike reviewer views, whose exit is Submit behind the ack.
 */
export const OWN_DRAFT_STALE_COMPOSER_REASON =
  "This isn't the pull request's current revision. Switch to the latest revision to comment.";

/**
 * Own-draft state wiring (BRIEF-43, ADR 0031): injected by the DB route ONLY
 * while `draft && viewerIsAuthor` holds on the PrView (derived at read time,
 * single source: `features/pulls/ownDraft`). Present → the screen labels the
 * state (self-review chip), hides the submit/receipt machinery, renders flags
 * as a read-only mirror, and puts "Mark ready for review" in the terminal-
 * action slot. Absent (local path, any reviewer view) → nothing changes.
 */
export interface OwnDraftPlan {
  /**
   * POSTs mark-ready; on success it awaits the pr-view invalidation, so the
   * own-draft UI stays stable until the refreshed PrView actually flips.
   *
   * ABSENT while a historical revision is in view: the soft gate lists the
   * rendered Brief's flags and the contract is "ALL current-head flags", so
   * the action (and the gate with it) only exists on the current head. The
   * CTA then stays focusable and a click announces why (the BRIEF-24
   * disabled-with-reason pattern).
   */
  readonly markReady?: MarkReadyAction;
  /**
   * Posts a staged draft comment NOW as a standalone inline review comment
   * (per-comment post-now, ADR 0031). Anchors from the comment's chunk-region
   * data; `commit_id` is pinned to the viewed head by the route. ABSENT on the
   * same terms as `markReady` — only while the CURRENT head is in view (a
   * historical/advanced span would pin a stale commit, so the composer is
   * already read-only there); its absence hides the Post affordance.
   */
  readonly postComment?: (
    anchor: CommentAnchor,
    body: string,
  ) => Promise<PostCommentResult>;
}

export interface BriefScreenProps {
  /**
   * Live webhook-maintained PR state (DB route, BRIEF-103): the header's
   * state badge prefers it over the artifact's stamped snapshot. Absent on
   * the local file path.
   */
  livePrState?: LivePrState | undefined;
  artifacts: LocalBriefSummary[];
  brief: Brief;
  repoConfig?: RepoConfigContext | null | undefined;
  briefId: string;
  comparisonPlan?: BriefComparisonPlan | undefined;
  model: ReturnType<typeof buildBriefViewModel>;
  searchParams: BriefSearchParams;
  submitReview?: SubmitReviewAction | undefined;
  conversation?: ConversationPlan | undefined;
  readOnly?: { reason: string } | undefined;
  /**
   * The `?thread=` landing target (BRIEF-24 reads it): opens the conversation
   * section and lands on that thread. Absent → no auto-open.
   */
  conversationFocusThreadId?: number | undefined;
  headerControls?: ReactNode | undefined;
  ownDraft?: OwnDraftPlan | undefined;
  /**
   * The rendered span's head is not the PR head (BRIEF-127): the composer
   * stays live, but the SubmitModal gates Submit behind an explicit ack.
   */
  staleHead?: boolean | undefined;
  /**
   * Opens the delta lens (BRIEF-102 since-marker link). Route-owned and
   * stable; absent where no navigation is wired (the local demo path).
   */
  openDeltaLens?: (() => void) | undefined;
}

export function BriefScreen({
  livePrState,
  artifacts,
  brief,
  repoConfig,
  briefId,
  comparisonPlan,
  model,
  searchParams,
  conversation,
  conversationFocusThreadId,
  headerControls,
  openDeltaLens,
  ownDraft,
  readOnly,
  staleHead,
  submitReview,
}: BriefScreenProps) {
  const attributeRail = useMemo(() => buildAttributeRail(model), [model]);

  // Comparison overlay (ADR 0024): timeline, View/Compare resolution, and
  // the active baseline's marks/narrative/delta — see the hook.
  const {
    activeCompare,
    activeRawSpanDiff,
    availability,
    compareState,
    comparison,
    delta,
    marks,
    narrative,
    sinceReviewMarks,
    skipReason,
    timeline,
  } = useComparisonOverlay({
    artifacts,
    brief,
    briefId,
    comparisonPlan,
    searchParams,
  });

  // Per-group changed-since data (BRIEF-102): derived once per marks/model
  // change so StoryView's per-card primitive props stay stable across
  // unrelated screen re-renders.
  const sinceMarkers = useMemo(() => {
    const counts = groupSinceMarkers(model.groups, sinceReviewMarks);
    return counts === undefined || sinceReviewMarks === null
      ? undefined
      : { counts, baselineShortSha: sinceReviewMarks.baselineSha.slice(0, 7) };
  }, [model.groups, sinceReviewMarks]);

  // Own-draft state (BRIEF-43): the plan's presence IS the state — see the
  // block around `useMarkReadyFlow` below.
  const ownDraftActive = ownDraft !== undefined;
  // Own-draft stale views keep the composer read-only (BRIEF-127 preserves
  // BRIEF-43): post-now is the only write path in own-draft state and it
  // exists only at the current head, so a stale-staged draft would have no
  // exit. Reviewer stale views stay writable — their exit is batch Submit
  // behind the receipt ack.
  const composerDisabledReason =
    readOnly?.reason ??
    (ownDraftActive && staleHead === true
      ? OWN_DRAFT_STALE_COMPOSER_REASON
      : undefined);

  // The reading session (ADR 0022): per-brief Mind-Map store wiring, the
  // progress/receipt derivation, and the scroll/nav machinery — see the hook.
  const session = useReadingSession({
    brief,
    briefId,
    compareViewFull: compareState.view === "full",
    model,
    ownDraftActive,
    repoConfig,
  });
  const {
    actions,
    activeChunkId,
    chunkIds,
    focusMode,
    groupBoundaries,
    jumpToChunk,
    jumpToGroup,
    readingOrderedChunks,
    receipt,
    reviewComments,
    reviewOutcome,
    snapshot,
    submittedReviewIds,
    toggleFocusMode,
    viewMode,
  } = session;

  // Transient UI state stays local and colocated.
  const [submitOpen, setSubmitOpen] = useState(false);
  const [summaryPreviewOpen, setSummaryPreviewOpen] = useState(false);

  // Post-now in-flight tracking (BRIEF-43) — the MODULE-LEVEL registry's
  // per-brief view, subscribed here. Module state, not component state: a
  // same-tab remount with the same briefId (historical-revision round trip)
  // resets component state while the fetch closure survives — the registry
  // keeps the lockdown and the submit block alive across it.
  const postingCommentIds = useInFlightPosts(briefId);

  // The ephemeral review-flow store (composer anchor, risk targets/selection,
  // page toast): screen-created and screen-provided; the card tree subscribes
  // through chunk-/group-scoped selectors so the ChunkCard/GroupCard memo
  // boundaries keep their wins. Posture fields that affect first paint are
  // correct at creation; the late-derived rest syncs below the submit flow.
  const flowStore = useCreateReviewFlowStore({
    composerDisabledReason,
    flagsReadOnly: ownDraftActive,
    postingCommentIds,
    postBlockedExternally: undefined,
    postComment: undefined,
  });
  // Stable for the store's lifetime — safe to read during render.
  const flowActions = flowStore.getState().actions;
  const announce = flowActions.announce;
  // The screen sits above its own provider, so it subscribes to the store
  // instance directly — booleans only, so a composer open re-renders the
  // screen solely on the open/close transition, never per anchor change.
  const toast = useStore(flowStore, (state) => state.toast);
  const composerOpen = useStore(
    flowStore,
    (state) => state.composerAnchor !== null,
  );
  const riskModalOpen = useStore(
    flowStore,
    (state) => state.dismissTarget !== null || state.evidenceTarget !== null,
  );
  // The review-comment draft (BRIEF-137) is store-owned so it survives the
  // submit surface closing, but the screen reads it through a stable getter —
  // never a subscription: the raw string changes per keystroke, and this
  // file's store discipline is booleans/transitions only (see above).
  const getReviewComment = useCallback(
    () => flowStore.getState().reviewComment,
    [flowStore],
  );

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => flowActions.clearToast(), 4200);
    return () => window.clearTimeout(timer);
  }, [flowActions, toast]);

  const openSubmit = () => setSubmitOpen(true);
  const closeSubmit = useCallback(() => setSubmitOpen(false), []);
  const openSummaryPreview = () => setSummaryPreviewOpen(true);
  // The conversation glue (section open/landing state, shared query + digest,
  // composer wiring, digest→diff jump choreography) — see the hook.
  const conversationWiring = useConversationWiring({
    briefId,
    conversation,
    conversationFocusThreadId,
    jumpToChunk,
    model,
    readingOrderedChunks,
    submittedReviewIds,
  });
  const submitFlow = useReviewSubmit({
    action: submitReview,
    briefId,
    outcome: reviewOutcome,
    comments: reviewComments,
    receipt,
    getReviewComment,
    consumeReviewComment: flowActions.consumeReviewComment,
    markSubmitted: (ids) => actions.markCommentsSubmitted(ids),
    recordSubmittedReview: (reviewId) =>
      actions.recordSubmittedReview(reviewId),
    announce,
    invalidateConversation: conversationWiring.invalidateConversation,
    closeSubmit,
    resetOutcome: () => actions.setOutcome("comment"),
    // Same-tab re-ship window: a post-now still settling when the own-draft
    // state exits (ready flip mid-request) is invisible to the payload
    // capture — the review would ship the still-draft comment and the 201
    // would flip it only afterwards, a duplicate on GitHub. Submit blocks
    // (reason + hard guard) until every post settles.
    blockedExternally:
      postingCommentIds.size > 0
        ? POST_COMMENT_COPY.submitWhilePosting
        : undefined,
  });
  const liveSubmit = submitFlow.available;
  // Primitive binding: the post path guards on it (a Submit in flight already
  // captured the drafts — posting one now would double-post when the review
  // lands), and the memoized card tree receives it as the Post block reason.
  const submitPending = submitFlow.pending;
  // Per-comment post-now (BRIEF-43, ADR 0031): present only in own-draft
  // state at the current head (`ownDraft.postComment`) — off the current head
  // the composer is read-only (the OWN_DRAFT_STALE_COMPOSER_REASON carve-out
  // above), so no draft can be staged to post.
  const postComment = ownDraft?.postComment;
  // The own-draft post-now flow (registry choreography, settled-post drain,
  // double-post guards in both directions) — see the hook.
  const { postDraftComment } = useOwnDraftFlow({
    actions,
    announce,
    briefId,
    invalidateConversation: conversationWiring.invalidateConversation,
    postComment,
    postingCommentIds,
    submitPending,
  });
  // The late-derived posture half: the post-now family exists only once the
  // submit flow and own-draft flow above are wired (both need `announce`).
  useSyncReviewFlowPosture(flowStore, {
    composerDisabledReason,
    flagsReadOnly: ownDraftActive,
    postingCommentIds,
    postBlockedExternally: submitPending
      ? POST_COMMENT_COPY.postWhileSubmitting
      : undefined,
    postComment: postComment !== undefined ? postDraftComment : undefined,
  });
  // This render's reviewer-overlay-open snapshot + the entry reset the
  // mark-ready flow's own-draft entry/exit effect drives (see the hook).
  const reviewerOverlayOpen = submitOpen || summaryPreviewOpen || riskModalOpen;
  const closeReviewerOverlays = useCallback(() => {
    setSubmitOpen(false);
    setSummaryPreviewOpen(false);
    flowActions.setDismissTarget(null);
    flowActions.setEvidenceTarget(null);
  }, [flowActions]);
  // The mark-ready soft gate (BRIEF-54) reaches the expanded intent bar
  // through this handle; null when the Brief carries no intentCheck.
  const intentBarRef = useRef<IntentBarHandle>(null);
  const exitToStoryView = session.exitToStoryView;
  const showIntentBar = useCallback(() => {
    exitToStoryView();
    window.setTimeout(() => intentBarRef.current?.expandAndScrollTo(), 0);
  }, [exitToStoryView]);
  // The own-draft terminal action (soft gate, opt-in post-drafts batch,
  // entry/exit/head-advance focus rescues) — see the hook.
  const markReady = useMarkReadyFlow({
    action: ownDraft?.markReady,
    announce,
    briefId,
    closeReviewerOverlays,
    flagCount: model.flags.length,
    intentCheck: brief.intentCheck,
    jumpToChunk,
    ownDraftActive,
    postDraft: postDraftComment,
    reviewComments,
    reviewerOverlayOpen,
    showIntentBar,
  });

  // Shortcuts stand down whenever an overlay holds focus (drawers/modals use
  // `inert`, which doesn't stop a window-level keydown listener on its own).
  const shortcutsDisabled =
    submitOpen ||
    summaryPreviewOpen ||
    markReady.gateOpen ||
    session.shortcutsOpen ||
    riskModalOpen ||
    composerOpen;
  useKeyboardShortcuts({
    chunkIds,
    groupBoundaries,
    activeChunkId,
    disabled: shortcutsDisabled,
    focusModeActive: focusMode,
    jumpToChunk: session.jumpToChunkFromShortcut,
    toggleFocusMode,
    toggleHelp: session.toggleShortcuts,
    jumpToConversation:
      conversation !== undefined
        ? conversationWiring.jumpToConversation
        : undefined,
  });

  // Plain handlers: every consumer below is non-memoized, so useCallback
  // would buy nothing (the memo boundary lives at ChunkCard/GroupCard).
  const submitFromModal = () => {
    // Read-only posture (BRIEF-24): the submit control disables focusably with
    // the reason (below) — this guards the click path itself.
    if (readOnly !== undefined) {
      announce(readOnly.reason);
      return;
    }
    if (liveSubmit) {
      submitFlow.submit();
      return;
    }
    setSubmitOpen(false);
    announce(
      "Mockup flow — submit posts your review natively to GitHub with one signature line linking this receipt.",
    );
  };
  const closeSummaryPreview = () => setSummaryPreviewOpen(false);
  const jumpToSubmitItem = (item: UnresolvedItem) => {
    setSubmitOpen(false);
    jumpToChunk(item.targetId);
  };
  const clearDrafts = () => {
    clearSnapshots();
    actions.reset(deriveInitialState(model));
  };

  return (
    <ReviewFlowProvider store={flowStore}>
      <Header
        brief={brief}
        livePrState={livePrState}
        repoConfig={repoConfig}
        briefId={briefId}
        timeline={timeline}
        model={model}
        totals={session.totals}
        progress={session.progress}
        viewMode={viewMode}
        setViewMode={session.setViewMode}
        openSubmit={openSubmit}
        clearDrafts={clearDrafts}
        availability={availability}
        compareState={compareState}
        /* DB path (plan present): the standalone preview route only resolves
           LOCAL brief ids — open the in-page drawer instead. */
        openSummaryPreviewDrawer={
          comparisonPlan === undefined ? undefined : openSummaryPreview
        }
        controlsSlot={headerControls}
        ownDraft={
          ownDraftActive
            ? {
                markReady: markReady.request,
                pending: markReady.pending,
                unavailable: !markReady.available,
              }
            : undefined
        }
      />
      {focusMode ? (
        <FocusBanner
          activeChunkId={activeChunkId}
          bannerRef={session.focusBannerRef}
          groups={model.groups}
          jumpToChunk={jumpToChunk}
          toggleFocusMode={toggleFocusMode}
        />
      ) : null}
      <main
        className={
          session.layoutMode === "split" && viewMode === "story"
            ? "main split-main"
            : "main"
        }
        id="main-content"
        tabIndex={-1}
        data-zen={focusMode ? "on" : undefined}
      >
        {focusMode ? null : <SummarySection brief={brief} />}

        {compareState.view === "changes" ? (
          <ChangesOnlyView
            compare={
              activeCompare === "last-review" ? "last-review" : "previous-brief"
            }
            brief={brief}
            model={model}
            narrative={narrative}
            marks={marks}
            skipReason={skipReason}
            delta={delta}
            rawSpanDiff={activeRawSpanDiff}
          />
        ) : (
          <>
            {viewMode === "story" && !focusMode ? (
              <>
                <AttributeJumpRail
                  jumpToGroup={jumpToGroup}
                  rail={attributeRail}
                />
                {brief.intentCheck ? (
                  <IntentBar
                    intentCheck={brief.intentCheck}
                    jumpToGroup={jumpToGroup}
                    ref={intentBarRef}
                  />
                ) : null}
                <GroupTocBar
                  activeGroupId={session.activeGroupId}
                  conversationGroupIds={conversationWiring.conversationGroupIds}
                  groups={model.groups}
                  jumpToGroup={jumpToGroup}
                />
              </>
            ) : null}

            {conversation !== undefined ? (
              <ConversationSection
                briefId={briefId}
                chunks={readingOrderedChunks}
                focusThreadId={conversationFocusThreadId}
                jumpToChunk={conversationWiring.jumpToChunkFromConversation}
                localComments={reviewComments}
                markCommentsSubmitted={(ids) =>
                  actions.markCommentsSubmitted(ids)
                }
                open={conversationWiring.open}
                onToggle={conversationWiring.toggleOpen}
                plan={conversation}
                submittedReviewIds={submittedReviewIds}
              />
            ) : null}

            {viewMode === "story" ? (
              <StoryView
                brief={brief}
                model={model}
                comparison={comparison}
                activeChunkId={activeChunkId}
                collapseSupporting={session.collapseSupporting}
                focusMode={focusMode}
                openDeltaLens={openDeltaLens}
                sinceMarkers={sinceMarkers}
                openChunks={session.openChunks}
                addressedReviewComments={brief.reviewComments}
                conversationByChunk={conversationWiring.conversationByChunk}
                conversationComposer={conversationWiring.conversationComposer}
                jumpToChunk={jumpToChunk}
                markReviewed={session.markReviewed}
                setCollapseSupporting={session.setCollapseSupporting}
                toggleChunk={session.toggleChunk}
                {...(compareState.view === "full" && chunkIds.length > 0
                  ? { startReadThrough: session.startReadThrough }
                  : {})}
              />
            ) : (
              <ConcernView
                brief={brief}
                model={model}
                jumpToChunk={jumpToChunk}
              />
            )}
          </>
        )}
      </main>
      {/* Submit-review machinery + receipt: HIDDEN (not broken) in the
          own-draft state (BRIEF-43, ADR 0031). The receipt is the terminal
          artifact of submitting a review; in own-draft the terminal action is
          mark-ready — no submit, no receipt ceremony, and none of these
          surfaces (nor their toasts) is reachable: the Header CTA slot swaps,
          the menu drops Summary preview, and no keyboard shortcut opens any
          of them. */}
      {ownDraftActive ? null : (
        <>
          <SubmitModal
            receipt={receipt}
            open={submitOpen}
            close={closeSubmit}
            outcome={reviewOutcome}
            setOutcome={(outcome) => actions.setOutcome(outcome)}
            submit={submitFromModal}
            unresolvedItems={session.unresolvedItems}
            jumpToItem={jumpToSubmitItem}
            submitPending={
              liveSubmit && readOnly === undefined ? submitFlow.pending : false
            }
            blockedReasonOverride={readOnly?.reason}
            blockedReasonWith={
              liveSubmit ? submitFlow.blockedReasonWith : undefined
            }
            submitError={
              liveSubmit && readOnly === undefined ? submitFlow.error : null
            }
            submitNote={liveSubmit ? submitFlow.note : null}
            staleHead={staleHead === true}
          />
          <SummaryPreviewDrawer
            brief={brief}
            open={summaryPreviewOpen}
            snapshot={snapshot}
            close={closeSummaryPreview}
          />
        </>
      )}
      {/* Flag-disposition machinery: unmounted with its controls — flags are
          a read-only mirror in the own-draft state (no author dispositions). */}
      {ownDraftActive ? null : <RiskFlagModals flagsById={model.flagsById} />}
      {/* The mark-ready soft gate (BRIEF-43): mounted only in the own-draft
          state, only while the action exists (current head in view — a
          historical revision's flags are not the gate's contract), and only
          when there is something to gate ON — risk flags OR unposted drafts
          (the batch expectation is global, not flags-only). Both zero skips
          the modal entirely (the CTA acts directly, and nothing gate-shaped
          exists in the DOM). */}
      {ownDraftActive &&
      markReady.available &&
      (model.flags.length > 0 || markReady.unpostedDraftCount > 0) ? (
        <MarkReadyModal
          open={markReady.gateOpen}
          flags={model.flags}
          unpostedDraftCount={markReady.unpostedDraftCount}
          close={markReady.closeGate}
          markReadyAnyway={markReady.markReadyAnyway}
          jumpToFlag={markReady.jumpToFlag}
          jumpToDrafts={markReady.jumpToDrafts}
          intentGapCount={markReady.intentGapCount}
          intentTensionCount={markReady.intentTensionCount}
          jumpToIntentGaps={markReady.jumpToIntentGaps}
          postDrafts={markReady.postDraftsOnReady}
          setPostDrafts={markReady.setPostDraftsOnReady}
          busyLabel={markReady.batchBusyLabel}
        />
      ) : null}
      <ShortcutsModal
        open={session.shortcutsOpen}
        close={session.closeShortcuts}
      />
      <div className={styles["kbdHint"]} data-testid="kbd-hint">
        {focusMode ? (
          <button className="btn" type="button" onClick={toggleFocusMode}>
            Exit focus (Z)
          </button>
        ) : null}
        <button
          aria-label="Keyboard shortcuts"
          className={styles["shortcutsTrigger"]}
          type="button"
          onClick={session.toggleShortcuts}
        >
          ?
        </button>
      </div>
      <div
        className={styles["toast"]}
        data-testid="brief-toast"
        data-state={toast ? "visible" : "hidden"}
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {toast}
      </div>
    </ReviewFlowProvider>
  );
}
