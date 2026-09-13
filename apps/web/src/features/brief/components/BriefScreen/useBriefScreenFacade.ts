import { useTranslation } from "react-i18next";
import type { TranslationKey } from "i18n";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";

import {
  useCreateReviewFlowStore,
  useReviewSession,
  useSyncReviewFlowPosture,
} from "@web/features/review/session";
import { useReviewSubmit } from "@web/features/review/hooks";
import type { UnresolvedItem } from "@web/features/review/utils";
import { useLatestRef } from "@web/hooks/useLatestRef";
import {
  useViewportBoundary,
  ViewportBands,
} from "@web/hooks/useViewportBoundary";
import { DiffViews } from "@web/components/DiffRows/types";
import { useKeyboardShortcuts } from "../../hooks/useKeyboardShortcuts";
import { useRevisionNavigation } from "../../hooks/useRevisionNavigation";
import { buildAttributeRail } from "../../utils/viewModel";
import { createChunkWindowRegistry } from "./chunkWindows";
import type { IntentBarHandle } from "./IntentBar/IntentBar";
import { useCreateReadingPositionStore } from "./readingPosition";
import { deriveVisibleRegions } from "./regions";
import { useSidebarState } from "./Sidebar";
import type { BriefScreenProps } from "./types";
import { useComparisonOverlay } from "./useComparisonOverlay";
import { useConversationWiring } from "./useConversationWiring";
import { useDelayedPending } from "./useDelayedPending";
import { useDiffViewPreference } from "./useDiffViewPreference";
import { useInFlightDraftPosts } from "./useInFlightDraftPosts";
import { useMarkReadyFlow } from "./useMarkReadyFlow";
import { POST_COMMENT_COPY_KEYS, useOwnDraftFlow } from "./useOwnDraftFlow";
import { useReadingSession } from "./useReadingSession";
import { groupSinceMarkers, resolveSidebarLayout } from "./utils";

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
  comparisonPlan,
  model,
  searchParams,
  conversation,
  conversationFocusThreadId,
  conversationFilter,
  exitChangesScope,
  clearDiffParam,
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

  const [submitOpen, setSubmitOpen] = useState(false);
  const [screenBriefId, setScreenBriefId] = useState(briefId);
  if (screenBriefId !== briefId) {
    setScreenBriefId(briefId);
    setSubmitOpen(false);
    setPendingScopeJump(null);
    changesEverShownRef.current = false;
    storyEverShownRef.current = false;
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
  const announce = flowActions.announce;
  const toast = useStore(flowStore, (state) => state.toast);
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
    submitOpen,
    toast,
    conversationWiring,
    revisionNav,
    submitFlow,
    liveSubmit,
    markReady,
    intentBarRef,
    flowStore,
    readingPosition,
    openSubmit,
    closeSubmit,
    submitFromModal,
    jumpToSubmitItem,
    conversationReadOnly,
    announce,
    diffView,
    toggleDiffView,
  };
}
