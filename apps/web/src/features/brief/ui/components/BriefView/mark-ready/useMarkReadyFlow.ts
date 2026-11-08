import type { IntentCheck } from "brief-core/types";
import { useTranslation } from "react-i18next";
import { useCallback, useLayoutEffect, useMemo } from "react";
import { useStore } from "zustand";
import { DraftCommentStatuses } from "types";

import { useLatestRef } from "@web/hooks/useLatestRef";
import {
  resolveJumpChunkId,
  type ChunkLocator,
  type ReviewComment,
} from "@web/features/review/utils";
import type { MarkReadyAction } from "../../../../model/types";
import type { RiskFlag } from "../../../../model/utils/view-model";
import type { ShownButtonRef } from "../hooks/usePhoneChrome";
import type { BriefViewStore } from "../store";
import { useMarkReady } from "./useMarkReady";
import { useMarkReadyBatch } from "./useMarkReadyBatch";
import { MarkReadyFlowKinds, type PostDraftOutcome } from "../types";
import {
  countIntentGaps,
  countIntentTensions,
  isMarkReadyGateMounted,
  markReadyBatchBusyLabel,
} from "../utils";
import { focusRescueTarget } from "../focus-rescue";

export interface UseMarkReadyFlowInput {
  /**
   * The route's mark-ready transport; ABSENT while a historical revision is
   * in view: the CTA then stays focusable and a click announces why.
   */
  action: MarkReadyAction | undefined;
  /** Page-level live-region channel (clear-then-set). */
  announce: (message: string) => void;
  /** Holds the gate's flow and its checkbox for this Brief. */
  viewStore: BriefViewStore;
  /**
   * Closes every reviewer overlay (drawers, pre-submit, disposition modals)
   * when the own-draft state is entered: must be referentially stable.
   */
  closeReviewerOverlays: () => void;
  flagCount: number;
  intentCheck: IntentCheck | undefined;
  jumpToChunk: (chunkId: string) => void;
  chunks: readonly ChunkLocator[];
  ownDraftActive: boolean;
  postDraft: (
    comment: ReviewComment,
    batchOwnsMessaging?: boolean,
  ) => Promise<PostDraftOutcome>;
  reviewComments: ReviewComment[];
  reviewerOverlayOpen: boolean;
  showIntentBar: () => void;
  /** The phone bar's Brief controls, the rescue target where the header CTA is hidden. */
  phoneControlsRef: ShownButtonRef;
}

export interface UseMarkReadyFlowValue {
  available: boolean;
  pending: boolean;
  request: () => void;
  gateOpen: boolean;
  /** The gate's modal is in the tree: open, closing, or posting a zero-flag batch. */
  gateMounted: boolean;
  closeGate: () => void;
  markReadyAnyway: () => void;
  batchBusyLabel: string | undefined;
  postDraftsOnReady: boolean;
  setPostDraftsOnReady: (checked: boolean) => void;
  unpostedDraftCount: number;
  intentGapCount: number;
  intentTensionCount: number;
  jumpToFlag: (flag: RiskFlag) => void;
  jumpToDrafts: () => void;
  jumpToIntentGaps: () => void;
}

export function useMarkReadyFlow(
  input: UseMarkReadyFlowInput,
): UseMarkReadyFlowValue {
  const { t } = useTranslation();
  const {
    action,
    announce,
    viewStore,
    closeReviewerOverlays,
    flagCount,
    intentCheck,
    jumpToChunk,
    chunks,
    ownDraftActive,
    postDraft,
    reviewComments,
    reviewerOverlayOpen,
    showIntentBar,
    phoneControlsRef,
  } = input;
  const markReadyFlow = useStore(viewStore, (state) => state.markReadyFlow);
  // Default UNCHECKED: posting is an outward write.
  const postDraftsOnReady = useStore(
    viewStore,
    (state) => state.postDraftsOnReady,
  );
  const { openMarkReadyGate, closeMarkReadyGate, setPostDraftsOnReady } =
    viewStore.getState().actions;

  // Destructured because the hook returns a fresh object literal per render;
  // `markReady` and `pending` are the stable/primitive dep-safe members.
  const { markReady, pending: markReadyPending } = useMarkReady({
    action,
    announce,
  });
  // A left-set overlay flag keeps `shortcutsDisabled` stuck and resurrects the
  // overlay once the PR is marked ready. The unmount drops focus on <body>
  // without a blur, so orphaned focus is re-homed on the terminal-slot CTA.
  const overlayWasOpenRef = useLatestRef(reviewerOverlayOpen);
  // Layout phase: a post settling before passive effects flush would read
  // the batch as current and run the next write.
  useLayoutEffect(() => {
    if (!ownDraftActive) {
      const flowAtExit = viewStore.getState().markReadyFlow;
      closeMarkReadyGate();
      if (flowAtExit.kind !== MarkReadyFlowKinds.CLOSED) {
        const activeAtExit = document.activeElement;
        if (activeAtExit === null || activeAtExit === document.body) {
          focusRescueTarget(phoneControlsRef);
        }
      }
      // A stopped batch announces once its in-flight post settles.
      if (flowAtExit.kind === MarkReadyFlowKinds.GATE) {
        announce(t("pulls.markReady.exited"));
      }
      return;
    }
    const active = document.activeElement;
    if (
      overlayWasOpenRef.current &&
      (active === null || active === document.body)
    ) {
      focusRescueTarget(phoneControlsRef);
      announce(t("pulls.markReady.ownDraftEntered"));
    }
    closeReviewerOverlays();
  }, [
    announce,
    closeMarkReadyGate,
    closeReviewerOverlays,
    overlayWasOpenRef,
    ownDraftActive,
    phoneControlsRef,
    t,
    viewStore,
  ]);
  const unpostedDraftComments = useMemo(
    () =>
      reviewComments.filter(
        (comment) => comment.status === DraftCommentStatuses.DRAFT,
      ),
    [reviewComments],
  );
  const markReadyAvailable = action !== undefined;
  // Mid-gate head advance: the route withholds `markReady` WITHOUT a remount,
  // so the modal unmounts while its open flag stays set.
  useLayoutEffect(() => {
    if (!ownDraftActive || markReadyAvailable) {
      return;
    }
    const flowAtAdvance = viewStore.getState().markReadyFlow;
    if (flowAtAdvance.kind === MarkReadyFlowKinds.CLOSED) {
      return;
    }
    closeMarkReadyGate();
    const active = document.activeElement;
    if (active === null || active === document.body) {
      focusRescueTarget(phoneControlsRef);
    }
    if (flowAtAdvance.kind === MarkReadyFlowKinds.GATE) {
      announce(t("pulls.markReady.gateClosed"));
    }
  }, [
    announce,
    closeMarkReadyGate,
    markReadyAvailable,
    ownDraftActive,
    phoneControlsRef,
    t,
    viewStore,
  ]);
  const gateMounted = isMarkReadyGateMounted({
    ownDraftActive,
    markReadyAvailable,
    flagCount,
    unpostedDraftCount: unpostedDraftComments.length,
    flow: markReadyFlow,
  });
  // A gate whose last draft left elsewhere unmounts with nothing to show; its
  // flow closes so the shortcuts and the next Mark ready are live again.
  const gateEmptied =
    markReadyFlow.kind === MarkReadyFlowKinds.GATE &&
    ownDraftActive &&
    markReadyAvailable &&
    !gateMounted;
  useLayoutEffect(() => {
    if (gateEmptied) {
      closeMarkReadyGate();
    }
  }, [closeMarkReadyGate, gateEmptied]);
  const requestMarkReady = useCallback(() => {
    if (!markReadyAvailable) {
      announce(t("pulls.markReady.historicalRevision"));
      return;
    }
    // The CTA is aria-disabled (not hard disabled) while pending, so a click
    // still lands here and would reopen the gate over the running mutation.
    const refusesRequest =
      markReadyPending ||
      viewStore.getState().markReadyFlow.kind === MarkReadyFlowKinds.POSTING;
    if (refusesRequest) {
      return;
    }
    // The gate opens for risk flags OR unposted drafts: a zero-flag brief
    // with staged drafts must still offer the post-my-drafts checkbox, or the
    // drafts silently stay local while the PR goes ready.
    if (flagCount > 0 || unpostedDraftComments.length > 0) {
      setPostDraftsOnReady(false);
      openMarkReadyGate();
      return;
    }
    markReady();
  }, [
    announce,
    flagCount,
    markReady,
    markReadyAvailable,
    markReadyPending,
    openMarkReadyGate,
    setPostDraftsOnReady,
    t,
    unpostedDraftComments.length,
    viewStore,
  ]);
  // The reviewer's own close, refused while the batch writes.
  const cancelGate = useCallback((): boolean => {
    const posting =
      viewStore.getState().markReadyFlow.kind === MarkReadyFlowKinds.POSTING;
    if (!posting) {
      closeMarkReadyGate();
    }
    return !posting;
  }, [closeMarkReadyGate, viewStore]);
  const closeGate = useCallback(() => {
    cancelGate();
  }, [cancelGate]);
  const jumpToFlagFromGate = useCallback(
    (flag: RiskFlag) => {
      if (cancelGate()) {
        jumpToChunk(flag.chunkId);
      }
    },
    [cancelGate, jumpToChunk],
  );
  const jumpToDraftsFromGate = useCallback(() => {
    if (!cancelGate()) {
      return;
    }
    const first = unpostedDraftComments[0];
    if (first === undefined) {
      return;
    }
    const chunkId = resolveJumpChunkId(first, chunks);
    if (chunkId !== "") {
      jumpToChunk(chunkId);
    }
  }, [cancelGate, chunks, jumpToChunk, unpostedDraftComments]);
  // Intent lines never feed the gate's OPEN condition.
  const intentGapCount = countIntentGaps(intentCheck);
  const intentTensionCount = countIntentTensions(intentCheck);
  const jumpToIntentGapsFromGate = useCallback(() => {
    if (cancelGate()) {
      showIntentBar();
    }
  }, [cancelGate, showIntentBar]);
  const { runMarkReadyBatch } = useMarkReadyBatch({
    viewStore,
    announce,
    markReady,
    markReadyAvailable,
    ownDraftActive,
    postDraft,
    phoneControlsRef,
  });
  const markReadyAnyway = useCallback(() => {
    if (postDraftsOnReady && unpostedDraftComments.length > 0) {
      void runMarkReadyBatch(unpostedDraftComments);
      return;
    }
    if (cancelGate()) {
      markReady();
    }
  }, [
    cancelGate,
    markReady,
    postDraftsOnReady,
    runMarkReadyBatch,
    unpostedDraftComments,
  ]);

  return {
    available: markReadyAvailable,
    pending: markReadyPending,
    request: requestMarkReady,
    gateOpen: markReadyFlow.kind !== MarkReadyFlowKinds.CLOSED,
    gateMounted,
    closeGate,
    markReadyAnyway,
    batchBusyLabel: markReadyBatchBusyLabel(t, markReadyFlow),
    postDraftsOnReady,
    setPostDraftsOnReady,
    unpostedDraftCount: unpostedDraftComments.length,
    intentGapCount,
    intentTensionCount,
    jumpToFlag: jumpToFlagFromGate,
    jumpToDrafts: jumpToDraftsFromGate,
    jumpToIntentGaps: jumpToIntentGapsFromGate,
  };
}
