import { useTranslation } from "react-i18next";
import type { TranslationKey } from "i18n";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useStore } from "zustand";

import {
  useCreateReviewFlowStore,
  useDraftCommentCount,
  useReviewSession,
  useUnplacedDrafts,
} from "@web/features/review/session";
import { useReviewSubmit } from "@web/features/review/hooks";
import {
  commentLocation,
  findDraftComment,
  type UnresolvedItem,
} from "@web/features/review/utils";
import { useLatestRef } from "@web/hooks/useLatestRef";
import {
  useViewportBoundary,
  ViewportBands,
} from "@web/hooks/useViewportBoundary";
import { DiffViews } from "@web/components/DiffRows/types";
import { useCreateExpansionStore } from "../../../model/expansion/useExpansion";
import { useKeyboardShortcuts } from "../../hooks/useKeyboardShortcuts";
import { isGuestHost } from "../../utils/guest-rows";
import { useRevisionNavigation } from "../../hooks/useRevisionNavigation";
import { buildAttributeRail } from "../../../model/utils/viewModel";
import { createChunkWindowRegistry } from "./chunkWindows";
import type { IntentBarHandle } from "./IntentBar";
import { INTENT_BAR_ID } from "./IntentBar/consts";
import { useCreateReadingPositionStore } from "./readingPosition";
import { deriveVisibleRegions } from "./regions";
import { useCreateBriefScreenStore } from "./screen-store";
import { useSidebarState } from "./Sidebar/useSidebarState";
import type { BriefScreenProps, ChunkShare } from "./types";
import { useComparisonOverlay } from "./useComparisonOverlay";
import { useAddress } from "./address";
import { AddressEventKinds } from "./address/types";
import { useChunkDeepLink } from "./useChunkDeepLink";
import { useFocusArrival } from "./useFocusArrival";
import { useLineLinkLanding } from "./useLineLinkLanding";
import {
  LandHistories,
  LandMotions,
  LandPlacements,
  LandTargetKinds,
} from "./landing/types";
import type { ExpansionSource } from "../../../model/expansion/useExpansionSource";
import type { ReviewPosture } from "../../hooks/useReviewPosture";
import { useConversationWiring } from "./useConversationWiring";
import { useDelayedPending } from "./useDelayedPending";
import { useDiffViewPreference } from "./useDiffViewPreference";
import { useStoryCardTrack } from "./useStoryCardTrack";
import { useInFlightDraftPosts } from "./useInFlightDraftPosts";
import { useMarkReadyFlow } from "./useMarkReadyFlow";
import { POST_COMMENT_COPY_KEYS, useOwnDraftFlow } from "./useOwnDraftFlow";
import { useFocusPanel } from "./useFocusPanel";
import { useReadingSession } from "./useReadingSession";
import {
  buildReplyRecordingPlan,
  deriveShareUrl,
  groupSinceMarkers,
  resolveSidebarLayout,
} from "./utils";

/**
 * Own-draft composer block on a stale view: post-now exists only at the
 * current head, so a stale-staged draft would have no exit, unlike reviewer
 * views, whose exit is Submit behind the ack.
 */
export const OWN_DRAFT_STALE_COMPOSER_REASON_KEY: TranslationKey =
  "brief.screen.staleRevisionReason";

/** Without a review there is no session to save work to. */
const NO_REVIEW_REASON_KEY: TranslationKey = "brief.screen.fileBriefReadOnly";

export function useBriefScreenFacade({
  reading,
  address,
  pr,
  review,
  conversation,
}: BriefScreenProps) {
  const { t } = useTranslation();
  const { brief, briefId, model, fileRows, comparisonPlan, repoConfig } =
    reading;
  const { searchParams, link, exitChangesScope, clearDiffParam } = address;
  const ownDraft = review?.ownDraft;
  const staleHead = review?.staleHead === true;
  const conversationFocusThreadId = conversation?.focusThreadId;
  const conversationSource = conversation?.plan;
  const repoId = pr?.repoId;

  const attributeRail = useMemo(() => buildAttributeRail(model), [model]);
  const pendingShown = useDelayedPending(address.revisionPending);

  const overlay = useComparisonOverlay({
    brief,
    comparisonPlan,
    searchParams,
  });
  const { compareState, comparison, sinceReviewMarks } = overlay;

  const sinceMarkers = useMemo(() => {
    const counts = groupSinceMarkers(model.groups, sinceReviewMarks);
    return counts === undefined || sinceReviewMarks === null
      ? undefined
      : { counts, baselineShortSha: sinceReviewMarks.baselineSha.slice(0, 7) };
  }, [model.groups, sinceReviewMarks]);

  const ownDraftActive = ownDraft !== undefined;

  const sessionFrozen = useReviewSession((state) => state.frozen);
  const draftCommentCount = useDraftCommentCount();
  const frozenReason = sessionFrozen
    ? t("brief.screen.sessionFrozen")
    : undefined;
  const reviewReason =
    review === undefined ? t(NO_REVIEW_REASON_KEY) : review.readOnly?.reason;
  const writesDisabledReason = reviewReason ?? frozenReason;
  const writesDisabled = writesDisabledReason !== undefined;
  const staleOwnDraft = ownDraftActive && staleHead;
  const composerDisabledReason =
    writesDisabledReason ??
    (staleOwnDraft ? t(OWN_DRAFT_STALE_COMPOSER_REASON_KEY) : undefined);

  const chunkWindowsRef = useRef(createChunkWindowRegistry());
  const readingPosition = useCreateReadingPositionStore(briefId);
  const expansion = useCreateExpansionStore(briefId);
  const screen = useCreateBriefScreenStore(briefId, {
    model,
    initialFocusMode: searchParams.focus === true,
  });
  const { markScopeShown, setSubmitOpen } = screen.getState().actions;
  const session = useReadingSession({
    brief,
    briefId,
    compareViewFull: compareState.view === "full",
    model,
    ownDraftActive,
    repoConfig,
    chunkWindows: chunkWindowsRef.current,
    exitChangesScope,
    position: readingPosition,
    screen,
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

  const regions = deriveVisibleRegions({
    scope: compareState.view,
    focus: focusMode,
  });

  const band = useViewportBoundary();
  const focusPanel = useFocusPanel({
    position: readingPosition,
    focusMode,
    band,
  });
  const sidebar = useSidebarState(band, regions.sidebar);
  const sidebarLayout = resolveSidebarLayout(band, sidebar.expanded);
  const sheetOpen =
    band === ViewportBands.NARROW && regions.sidebar && sidebar.expanded;

  const sidebarWasVisible = useRef(regions.sidebar);
  useEffect(() => {
    const hidden = sidebarWasVisible.current && !regions.sidebar;
    sidebarWasVisible.current = regions.sidebar;
    if (!hidden || document.activeElement !== document.body) {
      return;
    }

    document.getElementById("main-content")?.focus({ preventScroll: true });
  }, [regions.sidebar]);

  const inChangesScope = compareState.view === "changes";
  const focusPanelShown = focusMode && !inChangesScope;

  // A pane stays mounted, hidden, once its scope has shown for this Brief,
  // so a flip back pays no remount.
  const scope = compareState.view;
  useEffect(() => {
    markScopeShown(scope);
  }, [markScopeShown, scope]);
  const changesPaneMounted = useStore(screen, (state) => {
    const mounted = inChangesScope || state.shownScopes.has("changes");
    return mounted;
  });
  const storyPaneMounted = useStore(screen, (state) => {
    const mounted = !inChangesScope || state.shownScopes.has("full");
    return mounted;
  });

  // A gesture from Changes scope leaves it with a history step and lands
  // once the story pane renders.
  const queueJumpFromChanges = (groupId: string, heading: boolean) => {
    if (heading) {
      session.jumpToGroupHeading(groupId, LandHistories.PUSH);
      return;
    }
    jumpToGroup(groupId, LandHistories.PUSH);
  };

  const submitOpen = useStore(screen, (state) => state.submitOpen);

  const inFlight = useInFlightDraftPosts();
  const postingCommentIds = inFlight.ids;

  const flowStore = useCreateReviewFlowStore(briefId);
  const flowActions = flowStore.getState().actions;
  // Both panes stay mounted across a scope switch, so a composer hosted by
  // the hidden pane would stay open unseen with the page shortcuts dead
  // behind it.
  useEffect(() => {
    const host = flowStore.getState().composerHost;
    if (host !== null && isGuestHost(host) !== inChangesScope) {
      flowActions.cancelComposer();
    }
  }, [flowActions, flowStore, inChangesScope]);
  const announce = flowActions.announce;
  const toast = useStore(flowStore, (state) => state.toast);
  const liveMessage = useStore(flowStore, (state) => state.liveMessage);
  const lineSelection = useStore(flowStore, (state) => state.lineSelection);
  const reanchorDraftId = useStore(flowStore, (state) => state.reanchorDraftId);
  const reanchorDraft = findDraftComment(reviewComments, reanchorDraftId);
  const reanchorLocation =
    reanchorDraft === undefined ? undefined : commentLocation(reanchorDraft);
  // The Cancel button leaves with the banner; focus goes to the content it
  // sat above rather than dropping to the body.
  const cancelReanchorFromBanner = () => {
    flowActions.cancelReanchor();
    document.getElementById("main-content")?.focus({ preventScroll: true });
  };
  const clearLineSelectionFromShortcut = () => {
    flowActions.clearLineSelection();
    flowActions.announceQuietly(t("review.announce.lineSelectionCleared"));
  };
  const addressHandle = useAddress({
    briefId,
    lineSelection: lineSelection ?? undefined,
    focusMode,
    scope: compareState.view,
    position: readingPosition,
    url: { link, focus: searchParams.focus === true },
    navigateLink: address.navigateLink,
    setFocusParam: address.setFocusParam,
  });
  useFocusArrival({
    focusInUrl: searchParams.focus === true,
    link,
    chunkIds,
    startReadThrough: session.startReadThrough,
  });
  const composerOpen = useStore(
    flowStore,
    (state) => state.composerAnchor !== null,
  );
  const riskModalOpen = useStore(
    flowStore,
    (state) => state.dismissTarget !== null || state.evidenceTarget !== null,
  );
  const getReviewComment = useCallback(
    () => flowStore.getState().reviewComment,
    [flowStore],
  );

  useEffect(() => {
    if (!toast) {
      return;
    }
    const timer = window.setTimeout(() => flowActions.clearToast(), 4200);
    return () => window.clearTimeout(timer);
  }, [flowActions, toast]);

  const writeError = useReviewSession((state) => state.writeError);
  const clearWriteError = actions.clearWriteError;
  useEffect(() => {
    if (writeError === null) {
      return;
    }
    announce(t(writeError));
    clearWriteError();
  }, [announce, clearWriteError, t, writeError]);

  const openSubmit = () => setSubmitOpen(true);
  const closeSubmit = useCallback(() => setSubmitOpen(false), [setSubmitOpen]);

  // Identity-stable per plan: both composer wirings memo on it.
  const recordSubmittedReview = actions.recordSubmittedReview;
  const conversationPlan = useMemo(
    () =>
      conversationSource === undefined
        ? undefined
        : buildReplyRecordingPlan(conversationSource, recordSubmittedReview),
    [conversationSource, recordSubmittedReview],
  );

  // A landing from a group's own controls puts the card's head under the
  // pinned stack, where the conversation's card landing rests too. Keyed on the stable jump, not the session object, so the memoized
  // group cards that take it keep their boundary.
  const sessionJumpToChunk = session.jumpToChunk;
  const jumpToChunkUnderStack = useCallback(
    (chunkId: string, behavior?: ScrollBehavior) =>
      sessionJumpToChunk(chunkId, behavior, LandPlacements.UNDER_STACK),
    [sessionJumpToChunk],
  );
  const conversationWiring = useConversationWiring({
    conversation: conversationPlan,
    conversationFocusThreadId,
    conversationFilter: conversation?.filter,
    land: session.land,
    setActiveChunk: session.setActiveChunk,
    model,
    readingOrderedChunks,
    submittedReviewIds,
  });

  // A link naming a chunk lands through the conversation landing: open the
  // card, scroll, focus, flash. Instant, not smooth: the windowed lists
  // mount and measure cards as the viewport passes, and each measurement
  // scroll-adjustment cancels a smooth scroll in flight. An arrival in
  // Changes scope leaves it by replace, since that scope was never a chosen
  // destination. A thread target owns its own arrival. A Changes section's
  // jump lands the same way, with a history step: its button leaves with the
  // pane, so focus goes to the card.
  const { jumpToChunkFromConversation } = conversationWiring;
  const queueChunkJumpFromChanges = (chunkId: string) => {
    jumpToChunkFromConversation(
      chunkId,
      undefined,
      "instant",
      LandHistories.PUSH,
    );
  };
  const landOnDeepLink = useCallback(
    (chunkId: string): boolean =>
      jumpToChunkFromConversation(
        chunkId,
        undefined,
        "instant",
        LandHistories.REPLACE,
      ),
    [jumpToChunkFromConversation],
  );
  // Hunk-edge expansion reads the file at the head sha through the pull's
  // API route; the local path has no route, so its edges stay folded.
  const expansionSource = useMemo((): ExpansionSource | undefined => {
    if (repoId === undefined) {
      return undefined;
    }
    return { repoId, prNumber: brief.pr.number, ref: brief.pr.sha };
  }, [repoId, brief.pr.number, brief.pr.sha]);
  const lineLanding = useLineLinkLanding({
    briefId,
    chunks: readingOrderedChunks,
    fileRows,
    rowsSettled: fileRows !== undefined,
    expansionSource,
    jumpToChunkFromConversation,
    selectLines: flowActions.selectLines,
    expandEdge: expansion.getState().actions.expandEdge,
    announce,
    announceQuietly: flowActions.announceQuietly,
    address: addressHandle,
    t,
  });
  useChunkDeepLink({
    briefId,
    chunkIds: session.chunkIds,
    link,
    enabled: conversationFocusThreadId === undefined,
    land: landOnDeepLink,
    landLine: lineLanding.landLine,
    address: addressHandle,
  });

  // The chunk glyph: once the URL names the chunk, a line selection stands
  // down in the same task, so it never writes its lines back.
  const commitChunkShare = useCallback(
    (chunkId: string): void => {
      addressHandle.send({ kind: AddressEventKinds.CHUNK_SHARED, chunkId });
      if (flowStore.getState().lineSelection !== null) {
        flowActions.clearLineSelection();
        flowActions.announceQuietly(t("review.announce.lineSelectionCleared"));
      }
    },
    [addressHandle, flowActions, flowStore, t],
  );
  const shareChunk = useMemo<ChunkShare>(
    () => ({
      deriveUrl: (chunkId) => deriveShareUrl(window.location, chunkId),
      commit: commitChunkShare,
    }),
    [commitChunkShare],
  );

  const revisionNav = useRevisionNavigation({
    chunks: readingOrderedChunks,
    marks: comparison.marks,
    getActiveChunkId: () => readingPosition.getState().activeChunkId,
    land: session.land,
  });

  const unplacedDrafts = useUnplacedDrafts();
  const submitFlow = useReviewSubmit({
    action: review?.submitReview,
    briefId,
    outcome: reviewOutcome,
    comments: reviewComments,
    unplacedDrafts,
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
    blockedExternally:
      postingCommentIds.size > 0
        ? t(POST_COMMENT_COPY_KEYS.SUBMIT_WHILE_POSTING)
        : undefined,
    trackWrite: actions.trackWrite,
    flowStore,
  });
  const liveSubmit = submitFlow.available;
  const submitPending = submitFlow.pending;
  const postComment = ownDraft?.postComment;

  const { postDraftComment } = useOwnDraftFlow({
    actions,
    announce,
    inFlight,
    invalidateConversation: conversationWiring.invalidateConversation,
    postComment,
    submitPending,
  });

  const flagsReadOnly = ownDraftActive || writesDisabled;
  const postBlockedExternally = submitPending
    ? t(POST_COMMENT_COPY_KEYS.POST_WHILE_SUBMITTING)
    : undefined;
  const postNow = postComment === undefined ? undefined : postDraftComment;
  // One identity per real change: every comment table reads this context.
  const posture = useMemo<ReviewPosture>(
    () => ({
      composerDisabledReason,
      flagsReadOnly,
      postingCommentIds,
      postBlockedExternally,
      postComment: postNow,
    }),
    [
      composerDisabledReason,
      flagsReadOnly,
      postingCommentIds,
      postBlockedExternally,
      postNow,
    ],
  );

  const reviewerOverlayOpen = submitOpen || riskModalOpen;
  const closeReviewerOverlays = useCallback(() => {
    setSubmitOpen(false);
    flowActions.setDismissTarget(null);
    flowActions.setEvidenceTarget(null);
  }, [flowActions, setSubmitOpen]);

  // The bar mounts with the story view, so its expand waits a task; the
  // landing waits for the mount on its own.
  const intentBarRef = useRef<IntentBarHandle>(null);
  const { exitToStoryView, land } = session;
  const showIntentBar = useCallback(() => {
    exitToStoryView();
    window.setTimeout(() => intentBarRef.current?.expand(), 0);
    land(
      { kind: LandTargetKinds.SECTION, sectionId: INTENT_BAR_ID },
      { motion: LandMotions.SMOOTH, history: LandHistories.NONE },
    );
  }, [exitToStoryView, land]);

  const markReady = useMarkReadyFlow({
    action: ownDraft?.markReady,
    announce,
    screen,
    closeReviewerOverlays,
    flagCount: model.flags.length,
    intentCheck: brief.intentCheck,
    jumpToChunk,
    chunks: readingOrderedChunks,
    ownDraftActive,
    postDraft: postDraftComment,
    reviewComments,
    reviewerOverlayOpen,
    showIntentBar,
  });

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

  const chunkFooter = {
    jumpToChunk: session.jumpToChunkFromShortcut,
    toggleViewed: markViewedFromShortcut,
  };

  const cardTrack = useStoryCardTrack();

  const diffPreference = useDiffViewPreference({
    search: searchParams.diff,
    clearDiffParam,
  });
  const diffView = diffPreference.view;
  const setDiffView = diffPreference.setView;

  const requestOtherDiffView = () => {
    const next =
      diffView === DiffViews.SPLIT ? DiffViews.UNIFIED : DiffViews.SPLIT;
    setDiffView(next);
    announce(
      next === DiffViews.SPLIT
        ? t("brief.diff.viewSplit")
        : t("brief.diff.viewUnified"),
    );
  };

  // Only the Full scope pairs rows. The Changes scope renders raw span diffs
  // that never split, so both entry points stand down there rather than
  // announcing a view the screen cannot show.
  const toggleDiffView = inChangesScope ? undefined : requestOtherDiffView;

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
    sheetOpen,
    focusModeActive: focusMode,
    jumpToChunk: session.jumpToChunkFromShortcut,
    toggleFocusMode,
    toggleHelp: session.toggleShortcuts,
    markViewed: markViewedFromShortcut,
    markViewedAvailable: compareState.view === "full",
    lineSelected: lineSelection !== null,
    clearLineSelection: clearLineSelectionFromShortcut,
    reanchorArmed: reanchorDraft !== undefined,
    cancelReanchor: flowActions.cancelReanchor,
    focusPanelOpen: focusPanelShown && focusPanel.open,
    toggleFocusPanel: focusPanelShown ? focusPanel.toggle : undefined,
    closeFocusPanel: focusPanel.close,
    jumpToConversation:
      conversation !== undefined && regions.conversation
        ? conversationWiring.jumpToConversation
        : undefined,
    toggleSidebar: regions.sidebar ? sidebar.toggle : undefined,
    toggleDiffView,
  });

  const submitFromModal = () => {
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

  const jumpToSubmitItem = (item: Pick<UnresolvedItem, "targetId">) => {
    if (item.targetId === "") {
      return;
    }
    setSubmitOpen(false);
    session.openChunk(item.targetId);
    jumpToChunk(item.targetId);
  };

  const conversationReadOnly =
    writesDisabledReason === undefined
      ? {}
      : { readOnlyReason: writesDisabledReason };

  return {
    t,
    chunkFooter,
    focusPanel,
    focusPanelShown,
    conversationPlan,
    attributeRail,
    pendingShown,
    overlay,
    sinceMarkers,
    ownDraftActive,
    writesDisabled,
    writesDisabledReason,
    session,
    regions,
    band,
    sidebar,
    sidebarLayout,
    inChangesScope,
    changesPaneMounted,
    storyPaneMounted,
    chunkWindowsRef,
    queueJumpFromChanges,
    queueChunkJumpFromChanges,
    submitOpen,
    toast,
    liveMessage,
    reanchorLocation,
    cancelReanchorFromBanner,
    conversationWiring,
    revisionNav,
    submitFlow,
    liveSubmit,
    markReady,
    intentBarRef,
    flowStore,
    posture,
    readingPosition,
    expansion,
    openSubmit,
    draftCommentCount,
    closeSubmit,
    submitFromModal,
    jumpToSubmitItem,
    conversationReadOnly,
    announce,
    diffView,
    toggleDiffView,
    cardTrack,
    expansionSource,
    lineLinkMissed: lineLanding.missed,
    dismissLineLinkMiss: lineLanding.dismissMiss,
    shareChunk,
    jumpToChunkUnderStack,
    staleHead,
  };
}
