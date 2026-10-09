import type { IntentCheck } from "brief-core/types";
import { useTranslation } from "react-i18next";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useLatestRef } from "@web/hooks/useLatestRef";
import {
  resolveJumpChunkId,
  type ChunkLocator,
  type ReviewComment,
} from "@web/features/review/utils";
import type { MarkReadyAction } from "@web/features/pulls/transport";
import { useMarkReady } from "@web/features/pulls/hooks";
import type { RiskFlag } from "../../utils/viewModel";
import { PostDraftOutcomes, type PostDraftOutcome } from "./types";
import {
  countIntentGaps,
  countIntentTensions,
  markReadyBatchBusyLabel,
  markReadyBatchFailureCopy,
} from "./utils";

export interface UseMarkReadyFlowInput {
  /**
   * The route's mark-ready transport; ABSENT while a historical revision is
   * in view: the CTA then stays focusable and a click announces why.
   */
  action: MarkReadyAction | undefined;
  /** Page-level live-region channel (clear-then-set). */
  announce: (message: string) => void;
  briefId: string;
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
}

export interface UseMarkReadyFlowValue {
  available: boolean;
  pending: boolean;
  request: () => void;
  gateOpen: boolean;
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
    briefId,
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
  } = input;
  const [markReadyGateOpen, setMarkReadyGateOpen] = useState(false);
  // Default UNCHECKED: posting is an outward write.
  const [postDraftsOnReady, setPostDraftsOnReady] = useState(false);
  const [markReadyBatch, setMarkReadyBatch] = useState<{
    current: number;
    total: number;
  } | null>(null);
  // Brief switch without remount: the gate lists the OLD brief's flags and
  // drafts: close it and drop the batch progress before the new brief paints.
  const [gateBriefId, setGateBriefId] = useState(briefId);
  if (gateBriefId !== briefId) {
    setGateBriefId(briefId);
    setMarkReadyGateOpen(false);
    setPostDraftsOnReady(false);
    setMarkReadyBatch(null);
  }

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
  const gateOpenRef = useLatestRef(markReadyGateOpen);
  useEffect(() => {
    if (!ownDraftActive) {
      setMarkReadyGateOpen(false);
      if (gateOpenRef.current) {
        const activeAtExit = document.activeElement;
        if (activeAtExit === null || activeAtExit === document.body) {
          document.querySelector<HTMLElement>("[data-terminal-slot]")?.focus();
        }
        announce(t("pulls.markReady.exited"));
      }
      return;
    }
    const active = document.activeElement;
    if (
      overlayWasOpenRef.current &&
      (active === null || active === document.body)
    ) {
      document.querySelector<HTMLElement>("[data-terminal-slot]")?.focus();
      announce(t("pulls.markReady.ownDraftEntered"));
    }
    closeReviewerOverlays();
  }, [
    announce,
    closeReviewerOverlays,
    gateOpenRef,
    overlayWasOpenRef,
    ownDraftActive,
    t,
  ]);
  // A batch failure closes the gate while the modal still holds focus. The
  // rescue must run AFTER React commits the close: a requestAnimationFrame is
  // not ordered against the commit, so under load it read the modal as still
  // open and left focus stranded inside an inert dialog.
  const [batchFailureRescue, setBatchFailureRescue] = useState(false);
  useEffect(() => {
    if (!batchFailureRescue) {
      return;
    }
    setBatchFailureRescue(false);

    const active = document.activeElement;
    const stranded =
      active === null ||
      active === document.body ||
      active.closest('[data-state="closed"]') !== null ||
      active.closest("[inert]") !== null;
    if (stranded) {
      document.querySelector<HTMLElement>("[data-terminal-slot]")?.focus();
    }
  }, [batchFailureRescue]);

  const unpostedDraftComments = useMemo(
    () => reviewComments.filter((comment) => comment.status === "draft"),
    [reviewComments],
  );
  const markReadyAvailable = action !== undefined;
  // Mid-gate head advance: the route withholds `markReady` WITHOUT a remount,
  // so the modal unmounts while its open flag stays set.
  useEffect(() => {
    if (!ownDraftActive || markReadyAvailable) {
      return;
    }
    if (!gateOpenRef.current) {
      return;
    }
    setMarkReadyGateOpen(false);
    const active = document.activeElement;
    if (active === null || active === document.body) {
      document.querySelector<HTMLElement>("[data-terminal-slot]")?.focus();
    }
    announce(t("pulls.markReady.gateClosed"));
  }, [announce, gateOpenRef, markReadyAvailable, ownDraftActive, t]);
  const requestMarkReady = useCallback(() => {
    if (!markReadyAvailable) {
      announce(t("pulls.markReady.historicalRevision"));
      return;
    }
    // The CTA is aria-disabled (not hard disabled) while pending, so a click
    // still lands here and would reopen the gate over the running mutation.
    if (markReadyPending) {
      return;
    }
    // The gate opens for risk flags OR unposted drafts: a zero-flag brief
    // with staged drafts must still offer the post-my-drafts checkbox, or the
    // drafts silently stay local while the PR goes ready.
    if (flagCount > 0 || unpostedDraftComments.length > 0) {
      setPostDraftsOnReady(false);
      setMarkReadyGateOpen(true);
      return;
    }
    markReady();
  }, [
    announce,
    flagCount,
    markReady,
    markReadyAvailable,
    markReadyPending,
    t,
    unpostedDraftComments.length,
  ]);
  const closeMarkReadyGate = useCallback(() => setMarkReadyGateOpen(false), []);
  const jumpToFlagFromGate = useCallback(
    (flag: RiskFlag) => {
      setMarkReadyGateOpen(false);
      jumpToChunk(flag.chunkId);
    },
    [jumpToChunk],
  );
  const jumpToDraftsFromGate = useCallback(() => {
    setMarkReadyGateOpen(false);
    const first = unpostedDraftComments[0];
    if (first === undefined) {
      return;
    }
    const chunkId = resolveJumpChunkId(first, chunks);
    if (chunkId !== "") {
      jumpToChunk(chunkId);
    }
  }, [chunks, jumpToChunk, unpostedDraftComments]);
  // Intent lines never feed the gate's OPEN condition.
  const intentGapCount = countIntentGaps(intentCheck);
  const intentTensionCount = countIntentTensions(intentCheck);
  const jumpToIntentGapsFromGate = useCallback(() => {
    setMarkReadyGateOpen(false);
    showIntentBar();
  }, [showIntentBar]);
  // Marks ready only if every post succeeded; any failure stops first. The
  // confirm CTA is aria-disabled while the batch runs, so a click can land
  // before the busy state renders: the guard must be a ref, not state.
  const batchInFlight = useRef(false);
  const runMarkReadyBatch = useCallback(
    async (drafts: readonly ReviewComment[]) => {
      if (batchInFlight.current) {
        return;
      }
      batchInFlight.current = true;
      try {
        const total = drafts.length;
        let posted = 0;
        for (const draft of drafts) {
          setMarkReadyBatch({ current: posted + 1, total });
          // Sequential BY DESIGN: a failure must STOP the run before the next
          // outward write and before mark-ready, Promise.all would defeat
          // the stop-on-failure contract.
          // oxlint-disable-next-line no-await-in-loop
          const outcome = await postDraft(draft, true);
          if (outcome !== PostDraftOutcomes.POSTED) {
            setMarkReadyBatch(null);
            setMarkReadyGateOpen(false);
            // Per-comment copy is suppressed for the batch, so this summary
            // is the run's only live-region write.
            announce(markReadyBatchFailureCopy(t, posted, total, outcome));
            // Neither sibling rescue fires here (no state exit, no head
            // advance), so the effect below re-homes focus once the close has
            // committed.
            setBatchFailureRescue(true);
            return;
          }
          posted += 1;
        }
        setMarkReadyBatch(null);
        setMarkReadyGateOpen(false);
        markReady();
      } finally {
        batchInFlight.current = false;
      }
    },
    [announce, markReady, postDraft, t],
  );
  const markReadyAnyway = useCallback(() => {
    if (postDraftsOnReady && unpostedDraftComments.length > 0) {
      void runMarkReadyBatch(unpostedDraftComments);
      return;
    }
    setMarkReadyGateOpen(false);
    markReady();
  }, [markReady, postDraftsOnReady, runMarkReadyBatch, unpostedDraftComments]);

  return {
    available: markReadyAvailable,
    pending: markReadyPending,
    request: requestMarkReady,
    gateOpen: markReadyGateOpen,
    closeGate: closeMarkReadyGate,
    markReadyAnyway,
    batchBusyLabel: markReadyBatchBusyLabel(t, markReadyBatch),
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
