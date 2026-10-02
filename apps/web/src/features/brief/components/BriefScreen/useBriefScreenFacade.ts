import { useTranslation } from "react-i18next";
import type { TranslationKey } from "i18n";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";

import {
  useCreateReviewFlowStore,
  useDraftCommentCount,
  useReviewSession,
  useSyncReviewFlowPosture,
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
import { useKeyboardShortcuts } from "../../hooks/useKeyboardShortcuts";
import { isGuestHost } from "../../utils/guest-rows";
import { useRevisionNavigation } from "../../hooks/useRevisionNavigation";
import { buildAttributeRail } from "../../utils/viewModel";
import { createChunkWindowRegistry } from "./chunkWindows";
import type { IntentBarHandle } from "./IntentBar";
import { useCreateReadingPositionStore } from "./readingPosition";
import { deriveVisibleRegions } from "./regions";
import { useSidebarState } from "./Sidebar/useSidebarState";
import type { BriefScreenProps, ChunkShare } from "./types";
import { useComparisonOverlay } from "./useComparisonOverlay";
import { useChunkDeepLink } from "./useChunkDeepLink";
import { useFocusAddress } from "./useFocusAddress";
import { useLineLinkLanding } from "./useLineLinkLanding";
import type { ExpansionSource } from "../../hooks/useExpansionSource";
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
  deriveLineLink,
  deriveShareUrl,
  groupSinceMarkers,
  isLineLink,
  resolveSidebarLayout,
} from "./utils";

/**
 * Own-draft composer block on a stale view: post-now exists only at the
 * current head, so a stale-staged draft would have no exit, unlike reviewer
 * views, whose exit is Submit behind the ack.
 */
export const OWN_DRAFT_STALE_COMPOSER_REASON_KEY: TranslationKey =
  "brief.screen.staleRevisionReason";

export type BriefScreenFacadeParams = BriefScreenProps;

export function useBriefScreenFacade({
  artifacts,
  brief,
  repoConfig,
  briefId,
  repoId,
  fileRows,
  comparisonPlan,
  model,
  searchParams,
  conversation,
  conversationFocusThreadId,
  conversationFilter,
  exitChangesScope,
  clearDiffParam,
  link,
  navigateLink,
  setFocusParam,
  ownDraft,
  readOnly,
  revisionPending,
  staleHead,
  submitReview,
}: BriefScreenFacadeParams) {
  const { t } = useTranslation();

  const attributeRail = useMemo(() => buildAttributeRail(model), [model]);
  const pendingShown = useDelayedPending(revisionPending === true);

  const overlay = useComparisonOverlay({
    artifacts,
    brief,
    briefId,
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
  const writesDisabledReason = readOnly?.reason ?? frozenReason;
  const writesDisabled = writesDisabledReason !== undefined;
  const composerDisabledReason =
    writesDisabledReason ??
    (ownDraftActive && staleHead === true
      ? t(OWN_DRAFT_STALE_COMPOSER_REASON_KEY)
      : undefined);

  const chunkWindowsRef = useRef(createChunkWindowRegistry());
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
    initialFocusMode: searchParams.focus === true,
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
    if (!hidden || document.activeElement !== document.body) return;

    document.getElementById("main-content")?.focus({ preventScroll: true });
  }, [regions.sidebar]);

  const [pendingScopeJump, setPendingScopeJump] = useState<{
    groupId: string;
    heading: boolean;
  } | null>(null);
  const inChangesScope = compareState.view === "changes";
  const focusPanelShown = focusMode && !inChangesScope;

  const changesEverShownRef = useRef(false);
  if (inChangesScope) changesEverShownRef.current = true;
  const storyEverShownRef = useRef(false);
  if (!inChangesScope) storyEverShownRef.current = true;

  const jumpToGroupHeading = session.jumpToGroupHeading;
  useEffect(() => {
    if (pendingScopeJump === null || inChangesScope) return;
    if (pendingScopeJump.heading) {
      jumpToGroupHeading(pendingScopeJump.groupId);
    } else {
      jumpToGroup(pendingScopeJump.groupId);
    }
    setPendingScopeJump(null);
  }, [inChangesScope, jumpToGroup, jumpToGroupHeading, pendingScopeJump]);

  const queueJumpFromChanges = (groupId: string, heading: boolean) => {
    if (!inChangesScope) {
      if (heading) {
        jumpToGroupHeading(groupId);
        return;
      }
      jumpToGroup(groupId);
      return;
    }
    if (exitChangesScope === undefined) return;
    setPendingScopeJump({ groupId, heading });
    exitChangesScope();
  };

  // A chunk parked by a deep-link arrival in Changes scope, or by a flag's
  // jump from a Changes section, landed once the story pane renders.
  const [pendingDeepLink, setPendingDeepLink] = useState<string | null>(null);
  const queueChunkJumpFromChanges = (chunkId: string) => {
    if (!inChangesScope) {
      jumpToChunk(chunkId);
      return;
    }
    if (exitChangesScope === undefined) {
      return;
    }
    setPendingDeepLink(chunkId);
    exitChangesScope();
  };

  // The link param follows the selection with replace. The ref remembers
  // what this page wrote, so a clear never drops a link the reader arrived on.
  const writtenLinkRef = useRef<string | undefined>(undefined);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [screenBriefId, setScreenBriefId] = useState(briefId);
  if (screenBriefId !== briefId) {
    setScreenBriefId(briefId);
    setSubmitOpen(false);
    setPendingScopeJump(null);
    setPendingDeepLink(null);
    changesEverShownRef.current = false;
    storyEverShownRef.current = false;
    writtenLinkRef.current = undefined;
  }

  const inFlight = useInFlightDraftPosts();
  const postingCommentIds = inFlight.ids;

  const flowStore = useCreateReviewFlowStore(briefId, {
    composerDisabledReason,
    flagsReadOnly: ownDraftActive || writesDisabled,
    postingCommentIds,
    postBlockedExternally: undefined,
    postComment: undefined,
  });
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
  useEffect(() => {
    if (navigateLink === undefined) {
      return;
    }
    const next =
      lineSelection === null ? undefined : deriveLineLink(lineSelection);
    const written = writtenLinkRef.current;
    // A clear only takes back a line link still in the URL; a chunk link
    // this page wrote outlives the selection it stood down.
    const ownLineLink = isLineLink(written) && written === link;
    if (next === undefined && !ownLineLink) {
      if (isLineLink(written)) {
        writtenLinkRef.current = undefined;
      }
      return;
    }
    if (written === next) {
      return;
    }
    writtenLinkRef.current = next;
    navigateLink(next);
  }, [lineSelection, link, navigateLink]);
  useFocusAddress({
    focusMode,
    focusInUrl: searchParams.focus === true,
    setFocusParam,
    link,
    navigateLink,
    writtenLink: writtenLinkRef,
    chunkIds,
    position: readingPosition,
    lineSelected: lineSelection !== null,
    inChangesScope,
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
    if (!toast) return;
    const timer = window.setTimeout(() => flowActions.clearToast(), 4200);
    return () => window.clearTimeout(timer);
  }, [flowActions, toast]);

  const writeError = useReviewSession((state) => state.writeError);
  const clearWriteError = actions.clearWriteError;
  useEffect(() => {
    if (writeError === null) return;
    announce(t(writeError));
    clearWriteError();
  }, [announce, clearWriteError, t, writeError]);

  const openSubmit = () => setSubmitOpen(true);
  const closeSubmit = useCallback(() => setSubmitOpen(false), []);

  // Identity-stable per plan: both composer wirings memo on it.
  const recordSubmittedReview = actions.recordSubmittedReview;
  const conversationPlan = useMemo(
    () =>
      conversation === undefined
        ? undefined
        : buildReplyRecordingPlan(conversation, recordSubmittedReview),
    [conversation, recordSubmittedReview],
  );

  // A landing from a link, the conversation or a group's own controls puts
  // the card's head under the pinned stack, where the landing watch corrects
  // to. Keyed on the stable jump, not the session object, so the memoized
  // group cards that take it keep their boundary.
  const sessionJumpToChunk = session.jumpToChunk;
  const jumpToChunkUnderStack = useCallback(
    (chunkId: string, behavior?: ScrollBehavior) =>
      sessionJumpToChunk(chunkId, behavior, "top"),
    [sessionJumpToChunk],
  );
  const conversationWiring = useConversationWiring({
    briefId,
    conversation: conversationPlan,
    conversationFocusThreadId,
    conversationFilter,
    jumpToChunk: jumpToChunkUnderStack,
    cancelChunkScroll: session.cancelChunkScroll,
    ensureChunkOpen: session.openChunk,
    model,
    readingOrderedChunks,
    submittedReviewIds,
  });

  // A link naming a chunk lands through the conversation landing: open the
  // card, scroll, focus, flash. Instant, not smooth: the windowed lists
  // mount and measure cards as the viewport passes, and each measurement
  // scroll-adjustment cancels a smooth scroll in flight. Cards exist only
  // in the story pane, so an arrival in Changes scope leaves it first,
  // replacing the URL since that scope was never a chosen destination, and
  // lands once the pane renders. A thread target owns its own arrival.
  const { jumpToChunkFromConversation } = conversationWiring;
  useEffect(() => {
    if (pendingDeepLink === null || inChangesScope) return;
    jumpToChunkFromConversation(pendingDeepLink, undefined, "instant");
    setPendingDeepLink(null);
  }, [inChangesScope, jumpToChunkFromConversation, pendingDeepLink]);
  const landOnDeepLink = useCallback(
    (chunkId: string): boolean => {
      if (!inChangesScope) {
        jumpToChunkFromConversation(chunkId, undefined, "instant");
        return true;
      }
      if (exitChangesScope === undefined) return false;
      setPendingDeepLink(chunkId);
      exitChangesScope({ replace: true });
      return true;
    },
    [exitChangesScope, inChangesScope, jumpToChunkFromConversation],
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
    inChangesScope,
    exitChangesScope,
    jumpToChunkFromConversation,
    selectLines: flowActions.selectLines,
    expandEdge: flowActions.expandEdge,
    announce,
    announceQuietly: flowActions.announceQuietly,
    navigateLink,
    writtenLink: writtenLinkRef,
    t,
  });
  useChunkDeepLink({
    briefId,
    chunkIds: session.chunkIds,
    link,
    enabled: conversationFocusThreadId === undefined,
    land: landOnDeepLink,
    landLine: lineLanding.landLine,
    writtenLink: writtenLinkRef,
  });

  // The chunk glyph: the URL names the chunk, so once it is copied a line
  // selection stands down and its link goes with it; the write is the
  // page's own.
  const commitChunkShare = useCallback(
    (chunkId: string): void => {
      writtenLinkRef.current = chunkId;
      if (flowStore.getState().lineSelection !== null) {
        flowActions.clearLineSelection();
        flowActions.announceQuietly(t("review.announce.lineSelectionCleared"));
      }
      navigateLink?.(chunkId);
    },
    [flowActions, flowStore, navigateLink, t],
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
    blockedExternally:
      postingCommentIds.size > 0
        ? t(POST_COMMENT_COPY_KEYS.submitWhilePosting)
        : undefined,
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

  useSyncReviewFlowPosture(flowStore, {
    composerDisabledReason,
    flagsReadOnly: ownDraftActive || writesDisabled,
    postingCommentIds,
    postBlockedExternally: submitPending
      ? t(POST_COMMENT_COPY_KEYS.postWhileSubmitting)
      : undefined,
    postComment: postComment !== undefined ? postDraftComment : undefined,
  });

  const reviewerOverlayOpen = submitOpen || riskModalOpen;
  const closeReviewerOverlays = useCallback(() => {
    setSubmitOpen(false);
    flowActions.setDismissTarget(null);
    flowActions.setEvidenceTarget(null);
  }, [flowActions]);

  const intentBarRef = useRef<IntentBarHandle>(null);
  const exitToStoryView = session.exitToStoryView;
  const showIntentBar = useCallback(() => {
    exitToStoryView();
    window.setTimeout(() => intentBarRef.current?.expandAndScrollTo(), 0);
  }, [exitToStoryView]);

  const markReady = useMarkReadyFlow({
    action: ownDraft?.markReady,
    announce,
    briefId,
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

  // Only the story lens pairs rows. The Changes lens renders raw span diffs
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
    if (item.targetId === "") return;
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
    changesEverShownRef,
    storyEverShownRef,
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
    readingPosition,
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
    shareChunk: navigateLink === undefined ? undefined : shareChunk,
    jumpToChunkUnderStack,
  };
}
