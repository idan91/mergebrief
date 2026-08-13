import { useTranslation } from "react-i18next";
import type { TranslationKey } from "i18n";
import {
  memo,
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
import type { ConversationFilter } from "@web/features/conversation/utils/filter";
import { SubmitModal } from "@web/features/review";
import type { SubmitReviewAction } from "@web/features/review/utils/submit";
import { useReviewSubmit } from "@web/features/review/hooks/useReviewSubmit";
import {
  clearSnapshots,
  deriveInitialState,
  ReviewFlowProvider,
  useCreateReviewFlowStore,
  useMindMap,
  useSyncReviewFlowPosture,
} from "@web/features/review/session";
import { useLatestRef } from "@web/hooks/useLatestRef";
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
import { FocusBanner } from "./FocusBanner/FocusBanner";
import { IntentBar, type IntentBarHandle } from "./IntentBar/IntentBar";
import { GroupTocBar } from "./GroupTocBar/GroupTocBar";
import { Header } from "./Header/Header";
import { ReadingToolbar } from "./ReadingToolbar/ReadingToolbar";
import { RiskFlagModals } from "./RiskFlagModals/RiskFlagModals";
import { ShortcutsModal } from "./ShortcutsModal/ShortcutsModal";
import { StoryView } from "./StoryView/StoryView";
import { SummaryPreviewDrawer } from "./SummaryPreviewDrawer/SummaryPreviewDrawer";
import { SummarySection } from "./SummarySection/SummarySection";
import { useDelayedPending } from "./useDelayedPending";
import {
  useComparisonOverlay,
  type BriefComparisonPlan,
} from "./useComparisonOverlay";
import { useConversationWiring } from "./useConversationWiring";
import { useMarkReadyFlow } from "./useMarkReadyFlow";
import { POST_COMMENT_COPY_KEYS, useOwnDraftFlow } from "./useOwnDraftFlow";
import { deriveRegionBlocks } from "./modeLegality";
import { useReadingSession } from "./useReadingSession";
import styles from "./BriefScreen.module.scss";

export type { BriefComparisonPlan } from "./useComparisonOverlay";
// The door for the copy constants: tests live outside this subtree and may
// not reach into the hook files directly.
export { markReadyBatchFailureCopy } from "./utils";
import { groupSinceMarkers } from "./utils";
export { POST_COMMENT_COPY_KEYS } from "./useOwnDraftFlow";

/**
 * Own-draft composer block on a stale view: post-now exists only at the
 * current head, so a stale-staged draft would have no exit — unlike reviewer
 * views, whose exit is Submit behind the ack.
 */
export const OWN_DRAFT_STALE_COMPOSER_REASON_KEY: TranslationKey =
  "brief.screen.staleRevisionReason";

/**
 * Own-draft state wiring: injected by the DB route ONLY while
 * `draft && viewerIsAuthor` holds on the PrView (single source:
 * `features/pulls/ownDraft`). Present → the screen labels the state, hides the
 * submit/receipt machinery, renders flags as a read-only mirror, and puts
 * "Mark ready for review" in the terminal-action slot.
 */
export interface OwnDraftPlan {
  /**
   * POSTs mark-ready; on success it awaits the pr-view invalidation, so the
   * own-draft UI stays stable until the refreshed PrView actually flips.
   *
   * ABSENT while a historical revision is in view: the soft gate lists ALL
   * current-head flags, so the action (and the gate with it) only exists on
   * the current head. The CTA then stays focusable and a click announces why.
   */
  readonly markReady?: MarkReadyAction;
  /**
   * Posts a staged draft comment NOW as a standalone inline review comment.
   * Anchors from the comment's chunk-region data; `commit_id` is pinned to the
   * viewed head by the route. ABSENT on the same terms as `markReady` — only
   * while the CURRENT head is in view, since a historical/advanced span would
   * pin a stale commit; its absence hides the Post affordance.
   */
  readonly postComment?: (
    anchor: CommentAnchor,
    body: string,
  ) => Promise<PostCommentResult>;
}

/**
 * Render gate for a kept-warm lens tree: while `frozen`, the subtree is
 * skipped entirely (stale DOM stays, display:none hides it), so a lens flip
 * pays for ONE tree, not both. Store-subscribed descendants can still
 * re-render themselves — the latches reset on a brief switch so a frozen
 * pane never holds another brief's ids against a re-derived store.
 */
const LensPane = memo(
  function LensPane({ children }: LensPaneProps) {
    return children;
  },
  (_previous, next) => next.frozen,
);

export interface LensPaneProps {
  frozen: boolean;
  children: ReactNode;
}

export interface BriefScreenProps {
  /**
   * Live webhook-maintained PR state (DB route): the header's state badge
   * prefers it over the artifact's stamped snapshot. Absent on the local file
   * path.
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
   * The `?thread=` landing target: opens the conversation section and lands on
   * that thread. Absent → no auto-open.
   */
  conversationFocusThreadId?: number | undefined;
  /** Reviewer/verdict filter, carried in the URL by the route. */
  conversationFilter?: ConversationFilter | undefined;
  onConversationFilterChange?: ((next: ConversationFilter) => void) | undefined;
  headerControls?: ReactNode | undefined;
  ownDraft?: OwnDraftPlan | undefined;
  /**
   * The rendered span's head is not the PR head: the composer stays live, but
   * the SubmitModal gates Submit behind an explicit ack.
   */
  staleHead?: boolean | undefined;
  /**
   * Opens the delta lens from the since-marker link. Route-owned and stable;
   * absent where no navigation is wired (the local demo path).
   */
  openDeltaLens?: (() => void) | undefined;
  /**
   * Navigates the URL Scope axis back to `full`: the IntentBar renders in
   * Changes scope but its jump targets only exist in the full story flow, so
   * its jumps route through this first. Route-owned — the screen never touches
   * the router; absent where no navigation is wired.
   */
  exitChangesScope?: (() => void) | undefined;
  /**
   * A revision navigation is in flight: the stale content stays visible but
   * goes non-interactive (dim + inert, delayed so fast loads show nothing).
   * The sticky header stays live — last click wins.
   */
  revisionPending?: boolean | undefined;
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
  conversationFilter,
  onConversationFilterChange,
  headerControls,
  openDeltaLens,
  exitChangesScope,
  ownDraft,
  readOnly,
  revisionPending,
  staleHead,
  submitReview,
}: BriefScreenProps) {
  const { t } = useTranslation();
  const attributeRail = useMemo(() => buildAttributeRail(model), [model]);
  const pendingShown = useDelayedPending(revisionPending === true);

  // Comparison overlay: timeline, View/Compare resolution, and the active
  // baseline's marks/narrative/delta — see the hook.
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

  // Derived once per marks/model change so StoryView's per-card primitive
  // props stay stable across unrelated screen re-renders.
  const sinceMarkers = useMemo(() => {
    const counts = groupSinceMarkers(model.groups, sinceReviewMarks);
    return counts === undefined || sinceReviewMarks === null
      ? undefined
      : { counts, baselineShortSha: sinceReviewMarks.baselineSha.slice(0, 7) };
  }, [model.groups, sinceReviewMarks]);

  // The plan's presence IS the own-draft state.
  const ownDraftActive = ownDraft !== undefined;
  // Own-draft stale views keep the composer read-only: post-now is the only
  // write path there and it exists only at the current head, so a stale-staged
  // draft would have no exit. Reviewer stale views stay writable — their exit
  // is batch Submit behind the receipt ack.
  const composerDisabledReason =
    readOnly?.reason ??
    (ownDraftActive && staleHead === true
      ? t(OWN_DRAFT_STALE_COMPOSER_REASON_KEY)
      : undefined);

  // The reading session: per-brief Mind-Map store wiring, the progress/receipt
  // derivation, and the scroll/nav machinery — see the hook.
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

  // Region block presence: ONE derivation over the three axes — no per-block
  // ad-hoc gating below.
  const blocks = deriveRegionBlocks({
    lens: viewMode,
    scope: compareState.view,
    focus: focusMode,
  });

  // The IntentBar renders in Changes scope (its legality row) but its jump
  // targets (group/chunk anchors) only exist in the full story flow — so a
  // jump from Changes first navigates the Scope axis to `full`, then jumps
  // once the flipped scope actually renders (the effect below fires when
  // `compareState.view` leaves "changes"; a timeout would race the router).
  const [pendingIntentJump, setPendingIntentJump] = useState<string | null>(
    null,
  );
  const inChangesScope = compareState.view === "changes";
  // Monotonic first-show latches for the keep-warm lens trees below (ref
  // mutation in render is safe here: idempotent, and never flips back).
  const changesEverShownRef = useRef(false);
  if (inChangesScope) changesEverShownRef.current = true;
  const storyEverShownRef = useRef(false);
  if (!inChangesScope && viewMode === "story") storyEverShownRef.current = true;
  useEffect(() => {
    if (pendingIntentJump === null || inChangesScope) return;
    jumpToGroup(pendingIntentJump);
    setPendingIntentJump(null);
  }, [inChangesScope, jumpToGroup, pendingIntentJump]);
  const jumpToGroupFromIntentBar = (groupId: string) => {
    if (!inChangesScope) {
      jumpToGroup(groupId);
      return;
    }
    // No navigation wired (no-router harness): nothing can leave Changes,
    // so the jump stays a no-op rather than queueing forever.
    if (exitChangesScope === undefined) return;
    setPendingIntentJump(groupId);
    exitChangesScope();
  };

  // Transient UI state stays local and colocated.
  const [submitOpen, setSubmitOpen] = useState(false);
  const [summaryPreviewOpen, setSummaryPreviewOpen] = useState(false);
  // Brief switch without remount: screen-local overlay/jump state belongs to
  // the old brief — adjust during render so the new brief never paints with
  // an open submit surface or a queued jump against foreign ids.
  const [screenBriefId, setScreenBriefId] = useState(briefId);
  if (screenBriefId !== briefId) {
    setScreenBriefId(briefId);
    setSubmitOpen(false);
    setSummaryPreviewOpen(false);
    setPendingIntentJump(null);
    // Keep-warm lens trees do NOT survive a brief switch: a frozen pane
    // would hold the old brief's ids against the re-derived stores.
    changesEverShownRef.current = false;
    storyEverShownRef.current = false;
  }

  // The MODULE-LEVEL post-now registry's per-brief view. Module state, not
  // component state: a same-tab remount with the same briefId resets component
  // state while the fetch closure survives — the registry keeps the lockdown
  // and the submit block alive across it.
  const postingCommentIds = useInFlightPosts(briefId);

  // The ephemeral review-flow store (composer anchor, risk targets/selection,
  // page toast): screen-created and screen-provided; the card tree subscribes
  // through chunk-/group-scoped selectors so the ChunkCard/GroupCard memo
  // boundaries keep their wins. Posture fields that affect first paint are
  // correct at creation; the late-derived rest syncs below the submit flow.
  const flowStore = useCreateReviewFlowStore(briefId, {
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
  // The review-comment draft is store-owned so it survives the submit surface
  // closing, but the screen reads it through a stable getter — never a
  // subscription: the raw string changes per keystroke, and this file's store
  // discipline is booleans/transitions only (see above).
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
    conversationFilter,
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
        ? t(POST_COMMENT_COPY_KEYS.submitWhilePosting)
        : undefined,
  });
  const liveSubmit = submitFlow.available;
  // Primitive binding: the post path guards on it (a Submit in flight already
  // captured the drafts — posting one now would double-post when the review
  // lands), and the memoized card tree receives it as the Post block reason.
  const submitPending = submitFlow.pending;
  // Per-comment post-now: present only in own-draft state at the current head
  // — off the current head the composer is read-only, so no draft can be
  // staged to post.
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
      ? t(POST_COMMENT_COPY_KEYS.postWhileSubmitting)
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
  // The mark-ready soft gate reaches the expanded intent bar through this
  // handle; null when the Brief carries no intentCheck.
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

  // Pre-toggle state through a ref: markReviewed toggles, and the message
  // must name what the press DID.
  const reviewedChunks = useMindMap((state) => state.reviewedChunks);
  const reviewedChunksRef = useLatestRef(reviewedChunks);
  const markViewedFromShortcut = (chunkId: string) => {
    const wasViewed = reviewedChunksRef.current.has(chunkId);
    session.markReviewed(chunkId);
    announce(
      wasViewed
        ? t("brief.chunk.announceUnviewed")
        : t("brief.chunk.announceViewed"),
    );
  };

  // Shortcuts stand down whenever an overlay holds focus (drawers/modals use
  // `inert`, which doesn't stop a window-level keydown listener on its own).
  // Same hazard while a revision loads: the inert content region must not
  // accept j/k or mark-viewed writes against the stale brief.
  const shortcutsDisabled =
    submitOpen ||
    summaryPreviewOpen ||
    markReady.gateOpen ||
    session.shortcutsOpen ||
    riskModalOpen ||
    composerOpen ||
    pendingShown;
  useKeyboardShortcuts({
    chunkIds,
    groupBoundaries,
    activeChunkId,
    disabled: shortcutsDisabled,
    focusModeActive: focusMode,
    jumpToChunk: session.jumpToChunkFromShortcut,
    toggleFocusMode,
    toggleHelp: session.toggleShortcuts,
    // Keyboard-only announcement: the checkbox click is self-announcing.
    markViewed: markViewedFromShortcut,
    // Gated on the legality cell, not just plan presence: with the section
    // unmounted (focus mode, Changes scope) the target is gone — an
    // undefined action lets the shortcut hook's don't-swallow branch pass
    // the key through instead of eating it over a sticky `setOpen(true)`.
    jumpToConversation:
      conversation !== undefined && blocks.conversation
        ? conversationWiring.jumpToConversation
        : undefined,
  });

  // Plain handlers: every consumer below is non-memoized, so useCallback
  // would buy nothing (the memo boundary lives at ChunkCard/GroupCard).
  const submitFromModal = () => {
    // Read-only posture: the submit control disables focusably with the reason
    // (below) — this guards the click path itself.
    if (readOnly !== undefined) {
      announce(readOnly.reason);
      return;
    }
    if (liveSubmit) {
      submitFlow.submit();
      return;
    }
    setSubmitOpen(false);
    announce(t("brief.screen.mockupSubmit"));
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
        lensControl={blocks.lensControl}
        announce={announce}
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
        revisionPending={pendingShown}
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
      {/* `inert`, not pointer-events: keyboard and AT must block too. The
          header above stays live so the revision controls remain operable. */}
      <main
        className={
          session.layoutMode === "split" && viewMode === "story"
            ? "main split-main"
            : "main"
        }
        id="main-content"
        tabIndex={-1}
        data-zen={focusMode ? "on" : undefined}
        data-pending={pendingShown ? "" : undefined}
        aria-busy={pendingShown || undefined}
        inert={pendingShown || undefined}
      >
        {/* Region blocks render strictly off the legality derivation above —
            each block reads its own cell, nothing re-tests the axes. */}
        {blocks.summary ? (
          <>
            <SummarySection brief={brief} />
            {/* Directly beneath the capped summary — one legality row with
                it. */}
            {brief.intentCheck ? (
              <IntentBar
                key={`intent-${briefId}`}
                intentCheck={brief.intentCheck}
                jumpToGroup={jumpToGroupFromIntentBar}
                ref={intentBarRef}
              />
            ) : null}
          </>
        ) : null}

        {blocks.groupToc ? (
          <GroupTocBar
            key={`toc-${briefId}`}
            activeGroupId={session.activeGroupId}
            conversationGroupIds={conversationWiring.conversationGroupIds}
            groups={model.groups}
            jumpToGroup={jumpToGroup}
          />
        ) : null}

        {/* Sticky above the conversation slot — every control renders above
            everything it governs, and stays reachable while scrolling an
            expanded digest. The Filter disclosure is the ONLY filter surface:
            it governs the diff's inline threads and sits above the
            collapsed-by-default section it filters. Concerns renders the
            trimmed variant (Filter + Risk attrs, chunk targets). */}
        {blocks.toolbar !== "none" ? (
          <ReadingToolbar
            key={`toolbar-${briefId}`}
            variant={blocks.toolbar}
            activeGroupId={session.activeGroupId}
            comparison={comparison}
            filter={
              conversation !== undefined &&
              onConversationFilterChange !== undefined &&
              conversationWiring.conversationFilterFacets !== undefined
                ? {
                    /* The RECONCILED filter (facets.applied), not the
                       raw URL one: the trigger's receipt must never
                       count a selection that filters nothing. */
                    filter: conversationWiring.conversationFilterFacets.applied,
                    hiddenInlineThreads:
                      conversationWiring.conversationFilterFacets
                        .hiddenInlineThreads,
                    reviewers:
                      conversationWiring.conversationFilterFacets.reviewers,
                    verdicts:
                      conversationWiring.conversationFilterFacets.verdicts,
                    onChange: onConversationFilterChange,
                  }
                : undefined
            }
            groups={model.groups}
            jumpToChunk={jumpToChunk}
            jumpToGroup={jumpToGroup}
            rail={attributeRail}
            supportingCollapse={session.supportingCollapse}
            toggleCollapseSupporting={session.toggleCollapseSupporting}
          />
        ) : null}

        {blocks.conversation && conversation !== undefined ? (
          <ConversationSection
            key={`conversation-${briefId}`}
            briefId={briefId}
            chunks={readingOrderedChunks}
            filter={conversationFilter}
            focusThreadId={conversationFocusThreadId}
            jumpToChunk={conversationWiring.jumpToChunkFromConversation}
            localComments={reviewComments}
            markCommentsSubmitted={(ids) => actions.markCommentsSubmitted(ids)}
            open={conversationWiring.open}
            onToggle={conversationWiring.toggleOpen}
            plan={conversation}
            submittedReviewIds={submittedReviewIds}
          />
        ) : null}

        {/* Lens trees stay MOUNTED once shown and toggle with `hidden`
            (display:none — out of paint and the AT tree): the flip used to
            remount the alternate tree, and mounting 300 chunk cards is the
            entire lens lag. Kept warm only after first show, so a deep link
            into one lens never pays for the other. */}
        {changesEverShownRef.current ? (
          <div hidden={!inChangesScope || undefined}>
            <LensPane frozen={!inChangesScope}>
              <ChangesOnlyView
                key={`changes-${briefId}`}
                compare={
                  activeCompare === "last-review"
                    ? "last-review"
                    : "previous-brief"
                }
                brief={brief}
                model={model}
                narrative={narrative}
                marks={marks}
                skipReason={skipReason}
                delta={delta}
                rawSpanDiff={activeRawSpanDiff}
              />
            </LensPane>
          </div>
        ) : null}
        {storyEverShownRef.current ? (
          <div hidden={inChangesScope || viewMode !== "story" || undefined}>
            <LensPane frozen={inChangesScope || viewMode !== "story"}>
              <StoryView
                brief={brief}
                model={model}
                comparison={comparison}
                activeChunkId={activeChunkId}
                focusMode={focusMode}
                openDeltaLens={openDeltaLens}
                sinceMarkers={sinceMarkers}
                openChunks={session.openChunks}
                addressedReviewComments={brief.reviewComments}
                conversationByChunk={conversationWiring.conversationByChunk}
                conversationComposer={conversationWiring.conversationComposer}
                jumpToChunk={jumpToChunk}
                markReviewed={session.markReviewed}
                toggleChunk={session.toggleChunk}
                {...(compareState.view === "full" && chunkIds.length > 0
                  ? { startReadThrough: session.startReadThrough }
                  : {})}
              />
            </LensPane>
          </div>
        ) : null}
        {!inChangesScope && viewMode !== "story" ? (
          <ConcernView brief={brief} model={model} jumpToChunk={jumpToChunk} />
        ) : null}
      </main>
      {/* Submit-review machinery + receipt: HIDDEN (not broken) in the
          own-draft state, whose terminal action is mark-ready. None of these
          surfaces stays reachable: the Header CTA slot swaps, the menu drops
          Summary preview, and no keyboard shortcut opens any of them. */}
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
      {/* The mark-ready soft gate: mounted only in the own-draft state, only
          while the action exists (current head in view), and only when there
          is something to gate ON — risk flags OR unposted drafts. Both zero
          skips the modal entirely and the CTA acts directly. */}
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
            {t("brief.screen.exitFocus")}
          </button>
        ) : null}
        <button
          aria-label={t("brief.screen.ariaLabelShortcuts")}
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
