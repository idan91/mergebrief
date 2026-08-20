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

import { Button } from "@web/components/Button/Button";
import { IconButton } from "@web/components/IconButton/IconButton";
import {
  ConversationSection,
  type ConversationPlan,
} from "@web/features/conversation";
import type { ConversationFilter } from "@web/features/conversation/utils/filter";
import { SubmitModal } from "@web/features/review";
import type { SubmitReviewAction } from "@web/features/review/utils/submit";
import { useReviewSubmit } from "@web/features/review/hooks/useReviewSubmit";
import {
  ReviewFlowProvider,
  useCreateReviewFlowStore,
  useReviewSession,
  useSyncReviewFlowPosture,
  type ReviewSessionPayload,
} from "@web/features/review/session";
import { useLatestRef } from "@web/hooks/useLatestRef";
import type { UnresolvedItem } from "@web/features/review/utils/state";
import type { BriefSearchParams } from "../../comparison/compareState";
import { ChunkWindowProvider, createChunkWindowRegistry } from "./chunkWindows";
import type { MarkReadyAction } from "@web/features/pulls/transport/markReady";
import type { PostCommentResult } from "@web/features/pulls/transport/postComment";
// Direct component import, not the pulls barrel: the barrel now exports the
// PrBrief tree, which renders BriefView — importing it from here would close
// a brief -> pulls -> brief module cycle.
import { MarkReadyModal } from "@web/features/pulls/components/MarkReadyModal/MarkReadyModal";
import type { Brief, LivePrState, LocalBriefSummary } from "../../types";
import { useKeyboardShortcuts } from "../../hooks/useKeyboardShortcuts";
import { useRevisionNavigation } from "../../hooks/useRevisionNavigation";
import type { buildBriefViewModel } from "../../utils/viewModel";
import { buildAttributeRail } from "../../utils/viewModel";
import type { RepoConfigContext } from "../../utils/repoConfig";
import { ChangesOnlyView } from "./ChangesOnlyView/ChangesOnlyView";
import { ConcernStrip } from "./ConcernStrip/ConcernStrip";
import { FocusBanner } from "./FocusBanner/FocusBanner";
import { IntentBar, type IntentBarHandle } from "./IntentBar/IntentBar";
import { GroupTocBar } from "./GroupTocBar/GroupTocBar";
import { CarryOver } from "./CarryOver/CarryOver";
import { Header } from "./Header/Header";
import { ReadingToolbar } from "./ReadingToolbar/ReadingToolbar";
import { RiskFlagModals } from "./RiskFlagModals/RiskFlagModals";
import { ShortcutsModal } from "./ShortcutsModal/ShortcutsModal";
import { StoryView } from "./StoryView/StoryView";
import { SummarySection } from "./SummarySection/SummarySection";
import { UnattributedBanner } from "./UnattributedBanner/UnattributedBanner";
import { useDelayedPending } from "./useDelayedPending";
import {
  useComparisonOverlay,
  type BriefComparisonPlan,
} from "./useComparisonOverlay";
import { useConversationWiring } from "./useConversationWiring";
import { useInFlightDraftPosts } from "./useInFlightDraftPosts";
import { useMarkReadyFlow } from "./useMarkReadyFlow";
import { POST_COMMENT_COPY_KEYS, useOwnDraftFlow } from "./useOwnDraftFlow";
import { deriveRegionBlocks } from "./modeLegality";
import {
  ReadingPositionProvider,
  useCreateReadingPositionStore,
} from "./readingPosition";
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
   * It names the DRAFT: the session holds the text and the anchor, and the
   * commit is the named Brief's head. ABSENT on the same terms as
   * `markReady` — only while the CURRENT head is in view; its absence hides
   * the Post affordance.
   */
  readonly postComment?: (draftId: string) => Promise<PostCommentResult>;
}

/**
 * Render gate for a kept-warm scope pane: while `frozen`, the subtree is
 * skipped entirely (stale DOM stays, display:none hides it), so a scope flip
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
   * The server-held session read. Absent on the file path, where there is no
   * carry-over to state.
   */
  reviewSession?: ReviewSessionPayload | undefined;
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
  reviewSession,
  revisionPending,
  staleHead,
  submitReview,
}: BriefScreenProps) {
  const { t } = useTranslation();
  // Memoized as measured cost, not defensiveness: a model-wide scan has no
  // business re-running on every shell render (modal opens, review state).
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

  // Memoized on the same measured-cost grounds as attributeRail above.
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
  // Read-only is the WHOLE screen's posture, not the composer's: with no
  // session in hand a read mark or a dismissal is a write against work the
  // reviewer cannot see.
  // A frozen session is TERMINAL for this screen, not a per-action failure:
  // the reviewer has written against a newer Brief, so every retry fails
  // identically. Nothing drafts locally behind it — unsaved text stays
  // visible to copy, and the revision banner is the way out.
  const sessionFrozen = useReviewSession((state) => state.frozen);
  const frozenReason = sessionFrozen
    ? t("brief.screen.sessionFrozen")
    : undefined;
  /** Why every write is off right now; undefined = the screen is writable. */
  const writesDisabledReason = readOnly?.reason ?? frozenReason;
  const writesDisabled = writesDisabledReason !== undefined;
  const composerDisabledReason =
    writesDisabledReason ??
    (ownDraftActive && staleHead === true
      ? t(OWN_DRAFT_STALE_COMPOSER_REASON_KEY)
      : undefined);

  // The reading session: per-brief Review Session store wiring, the
  // progress/receipt derivation, and the scroll/nav machinery — see the hook.
  // One registry per screen: both scope panes' windowed lists register, and
  // the jump paths resolve unmounted chunks through it.
  const chunkWindowsRef = useRef(createChunkWindowRegistry());
  // Reading position lives in its own store so a scroll-spy tick re-renders
  // only the position consumers — never this screen shell.
  const readingPosition = useCreateReadingPositionStore(briefId);
  const session = useReadingSession({
    brief,
    briefId,
    compareViewFull: compareState.view === "full",
    model,
    ownDraftActive,
    repoConfig,
    chunkWindows: chunkWindowsRef.current,
    position: readingPosition,
  });
  const {
    actions,
    chunkIds,
    focusMode,
    groupBoundaries,
    jumpToChunk,
    jumpToGroup,
    readingOrderedChunks,
    receipt,
    reviewComments,
    reviewOutcome,
    submittedReviewIds,
    toggleFocusMode,
  } = session;

  // Region block presence: ONE derivation over the two axes — no per-block
  // ad-hoc gating below.
  const blocks = deriveRegionBlocks({
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
  // Monotonic first-show latches for the keep-warm scope panes below (ref
  // mutation in render is safe here: idempotent, and never flips back).
  const changesEverShownRef = useRef(false);
  if (inChangesScope) changesEverShownRef.current = true;
  const storyEverShownRef = useRef(false);
  if (!inChangesScope) storyEverShownRef.current = true;
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
  // Brief switch without remount: screen-local overlay/jump state belongs to
  // the old brief — adjust during render so the new brief never paints with
  // an open submit surface or a queued jump against foreign ids.
  const [screenBriefId, setScreenBriefId] = useState(briefId);
  if (screenBriefId !== briefId) {
    setScreenBriefId(briefId);
    setSubmitOpen(false);
    setPendingIntentJump(null);
    // Keep-warm scope panes do NOT survive a brief switch: a frozen pane
    // would hold the old brief's ids against the re-derived stores.
    changesEverShownRef.current = false;
    storyEverShownRef.current = false;
  }

  // One in-flight post-now request per draft: the button disables, and both
  // the submit block and the post block read the same set.
  const inFlight = useInFlightDraftPosts();
  const postingCommentIds = inFlight.ids;

  // The ephemeral review-flow store (composer anchor, risk targets/selection,
  // page toast): screen-created and screen-provided; the card tree subscribes
  // through chunk-/group-scoped selectors so the ChunkCard/GroupCard memo
  // boundaries keep their wins. Posture fields that affect first paint are
  // correct at creation; the late-derived rest syncs below the submit flow.
  const flowStore = useCreateReviewFlowStore(briefId, {
    composerDisabledReason,
    flagsReadOnly: ownDraftActive || writesDisabled,
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

  // A failed write reverted its own state change; the reviewer still has to
  // be TOLD, and the page live region is the surface that outlives whatever
  // drawer or composer started it.
  const writeError = useReviewSession((state) => state.writeError);
  const clearWriteError = actions.clearWriteError;
  useEffect(() => {
    if (writeError === null) return;
    announce(t(writeError));
    clearWriteError();
  }, [announce, clearWriteError, t, writeError]);

  const openSubmit = () => setSubmitOpen(true);
  const closeSubmit = useCallback(() => setSubmitOpen(false), []);
  // The conversation glue (section open/landing state, shared query + digest,
  // composer wiring, digest→diff jump choreography) — see the hook.
  const conversationWiring = useConversationWiring({
    briefId,
    conversation,
    conversationFocusThreadId,
    conversationFilter,
    jumpToChunk,
    ensureChunkOpen: session.openChunk,
    model,
    readingOrderedChunks,
    submittedReviewIds,
  });
  // Revision-change jumps navigate the MODEL's rail list — windowed chunk
  // lists mount too little DOM for enumeration to be truthful.
  // comparison.marks (the EFFECTIVE marks), not the raw overlay marks: rails
  // only render while the overlay applies, and the model list must agree
  // with the DOM by construction.
  const revisionNav = useRevisionNavigation({
    chunks: readingOrderedChunks,
    marks: comparison.marks,
    getActiveChunkId: () => readingPosition.getState().activeChunkId,
    scrollTowardChunk: (chunkId) =>
      chunkWindowsRef.current.scrollToChunk(chunkId),
    ensureChunkOpen: session.openChunk,
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
  // The own-draft post-now flow (in-flight gate, double-post guards in both
  // directions) — see the hook.
  const { postDraftComment } = useOwnDraftFlow({
    actions,
    announce,
    inFlight,
    invalidateConversation: conversationWiring.invalidateConversation,
    postComment,
    submitPending,
  });
  // The late-derived posture half: the post-now family exists only once the
  // submit flow and own-draft flow above are wired (both need `announce`).
  useSyncReviewFlowPosture(flowStore, {
    composerDisabledReason,
    flagsReadOnly: ownDraftActive || writesDisabled,
    postingCommentIds,
    postBlockedExternally: submitPending
      ? t(POST_COMMENT_COPY_KEYS.postWhileSubmitting)
      : undefined,
    postComment: postComment !== undefined ? postDraftComment : undefined,
  });
  // This render's reviewer-overlay-open snapshot + the entry reset the
  // mark-ready flow's own-draft entry/exit effect drives (see the hook).
  const reviewerOverlayOpen = submitOpen || riskModalOpen;
  const closeReviewerOverlays = useCallback(() => {
    setSubmitOpen(false);
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
  const reviewedChunks = useReviewSession((state) => state.reviewedChunks);
  const reviewedChunksRef = useLatestRef(reviewedChunks);
  const markViewedFromShortcut = (chunkId: string) => {
    if (writesDisabledReason !== undefined) {
      announce(writesDisabledReason);
      return;
    }
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
    markReady.gateOpen ||
    session.shortcutsOpen ||
    riskModalOpen ||
    composerOpen ||
    pendingShown;
  useKeyboardShortcuts({
    chunkIds,
    groupBoundaries,
    getActiveChunkId: () => readingPosition.getState().activeChunkId,
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
    if (writesDisabledReason !== undefined) {
      announce(writesDisabledReason);
      return;
    }
    if (liveSubmit) {
      submitFlow.submit();
      return;
    }
    setSubmitOpen(false);
    announce(t("brief.screen.mockupSubmit"));
  };
  // Both lists jump the same way, and neither needs more than the target: the
  // submit list's items and the carried ones share the mechanic, not a type.
  const jumpToSubmitItem = (item: Pick<UnresolvedItem, "targetId">) => {
    if (item.targetId === "") return;
    setSubmitOpen(false);
    // Resolving the item happens inside the card — a row-target jump.
    session.openChunk(item.targetId);
    jumpToChunk(item.targetId);
  };
  // exactOptionalPropertyTypes: the prop must be absent, not explicitly
  // undefined, so it is spread in rather than passed as a value.
  const conversationReadOnly =
    writesDisabledReason === undefined
      ? {}
      : { readOnlyReason: writesDisabledReason };

  return (
    <ReviewFlowProvider store={flowStore}>
      <ReadingPositionProvider store={readingPosition}>
        <Header
          brief={brief}
          livePrState={livePrState}
          repoConfig={repoConfig}
          briefId={briefId}
          timeline={timeline}
          model={model}
          totals={session.totals}
          progress={session.progress}
          openSubmit={openSubmit}
          availability={availability}
          compareState={compareState}
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
            session.layoutMode === "split" ? "main split-main" : "main"
          }
          id="main-content"
          tabIndex={-1}
          data-zen={focusMode ? "on" : undefined}
          data-pending={pendingShown ? "" : undefined}
          aria-busy={pendingShown || undefined}
          inert={pendingShown || undefined}
        >
          {reviewSession !== undefined ? (
            <CarryOver
              headSha={brief.pr.sha}
              jumpToItem={jumpToSubmitItem}
              model={model}
              session={reviewSession}
            />
          ) : null}

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

          {blocks.summary &&
          model.unattributed !== undefined &&
          model.unattributed.added + model.unattributed.deleted > 0 ? (
            <UnattributedBanner view={model.unattributed} />
          ) : null}

          {/* Full-brief rollup always — never a scope cut, no delta treatment
            under compare. */}
          {blocks.summary && brief.concernView.length >= 2 ? (
            <ConcernStrip rollup={brief.concernView} />
          ) : null}

          {blocks.groupToc ? (
            <GroupTocBar
              key={`toc-${briefId}`}
              conversationGroupIds={conversationWiring.conversationGroupIds}
              groups={model.groups}
              jumpToGroup={jumpToGroup}
            />
          ) : null}

          {/* Sticky above the conversation slot — every control renders above
            everything it governs, and stays reachable while scrolling an
            expanded digest. The Filter disclosure is the ONLY filter surface:
            it governs the diff's inline threads and sits above the
            collapsed-by-default section it filters. */}
          {blocks.toolbar ? (
            <ReadingToolbar
              key={`toolbar-${briefId}`}
              comparison={comparison}
              revisionNav={revisionNav}
              filter={
                conversation !== undefined &&
                onConversationFilterChange !== undefined &&
                conversationWiring.conversationFilterFacets !== undefined
                  ? {
                      /* The RECONCILED filter (facets.applied), not the
                       raw URL one: the trigger's receipt must never
                       count a selection that filters nothing. */
                      filter:
                        conversationWiring.conversationFilterFacets.applied,
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
              jumpToGroup={jumpToGroup}
              rail={attributeRail}
              supportingCollapse={session.supportingCollapse}
              toggleCollapseSupporting={session.toggleCollapseSupporting}
            />
          ) : null}

          {blocks.conversation && conversation !== undefined ? (
            <ConversationSection
              key={`conversation-${briefId}`}
              {...conversationReadOnly}
              chunks={readingOrderedChunks}
              filter={conversationFilter}
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

          {/* Scope panes stay MOUNTED once shown and toggle with `hidden`
            (display:none — out of paint and the AT tree): the flip used to
            remount the alternate tree, and mounting 300 chunk cards is the
            entire flip lag. Kept warm only after first show, so a deep link
            into one scope never pays for the other. The window provider sits
            here because only the scope panes' chunk lists window. */}
          <ChunkWindowProvider registry={chunkWindowsRef.current}>
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
              <div hidden={inChangesScope || undefined}>
                <LensPane frozen={inChangesScope}>
                  <StoryView
                    brief={brief}
                    model={model}
                    comparison={comparison}
                    focusMode={focusMode}
                    openDeltaLens={openDeltaLens}
                    sinceMarkers={sinceMarkers}
                    openChunks={session.openChunks}
                    addressedReviewComments={brief.reviewComments}
                    conversationByChunk={conversationWiring.conversationByChunk}
                    conversationComposer={
                      conversationWiring.conversationComposer
                    }
                    jumpToChunk={jumpToChunk}
                    markReviewed={session.markReviewed}
                    marksDisabled={writesDisabled}
                    toggleChunk={session.toggleChunk}
                    {...(compareState.view === "full" && chunkIds.length > 0
                      ? { startReadThrough: session.startReadThrough }
                      : {})}
                  />
                </LensPane>
              </div>
            ) : null}
          </ChunkWindowProvider>
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
              setOutcome={(outcome) => {
                // The picker is a write like any other: a read-only or frozen
                // screen states the reason instead of firing one that 409s.
                if (writesDisabledReason !== undefined) {
                  announce(writesDisabledReason);
                  return;
                }
                actions.setOutcome(outcome);
              }}
              submit={submitFromModal}
              unresolvedItems={session.unresolvedItems}
              jumpToItem={jumpToSubmitItem}
              submitPending={
                liveSubmit && !writesDisabled ? submitFlow.pending : false
              }
              blockedReasonOverride={writesDisabledReason}
              blockedReasonWith={
                liveSubmit ? submitFlow.blockedReasonWith : undefined
              }
              submitError={
                liveSubmit && !writesDisabled ? submitFlow.error : null
              }
              submitNote={liveSubmit ? submitFlow.note : null}
              staleHead={staleHead === true}
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
            <Button onClick={toggleFocusMode}>
              {t("brief.screen.exitFocus")}
            </Button>
          ) : null}
          <IconButton
            className={styles["shortcutsTrigger"]}
            label={t("brief.screen.ariaLabelShortcuts")}
            size="lg"
            variant="outlined"
            onClick={session.toggleShortcuts}
          >
            ?
          </IconButton>
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
      </ReadingPositionProvider>
    </ReviewFlowProvider>
  );
}
