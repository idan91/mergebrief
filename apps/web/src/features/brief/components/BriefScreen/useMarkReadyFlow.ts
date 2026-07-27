// The mark-ready facade hook: the own-draft terminal action. Wraps
// `useMarkReady` with the soft gate (risk flags OR unposted drafts), the
// opt-in "post my drafts, then mark ready" batch, the gate's intent-check
// lines, and the entry/exit/head-advance focus rescues.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useLatestRef } from "@web/hooks/useLatestRef";
import type { ReviewComment } from "@web/features/review/comments";
import type { MarkReadyAction } from "@web/features/pulls/markReady";
import { recordPostNotice } from "@web/features/pulls/postComment";
import { useMarkReady } from "@web/features/pulls/useMarkReady";
import type { IntentCheck } from "../../types";
import type { RiskFlag } from "../../utils/viewModel";
import type { PostDraftOutcome } from "./useOwnDraftFlow";
import {
  countIntentGaps,
  countIntentTensions,
  markReadyBatchBusyLabel,
  markReadyBatchFailureCopy,
} from "./utils";

/** Read by the live region when an external draft-flip closes reviewer overlays. */
export const OWN_DRAFT_ENTRY_ANNOUNCEMENT =
  "This pull request was converted to a draft. You're now viewing your own draft — review submission unlocks once it's marked ready for review.";

/** Announced when the CTA is used while a historical revision is in view. */
export const MARK_READY_HISTORICAL_REASON =
  "You're viewing an earlier revision. Switch to the latest revision to mark this pull request ready for review.";

/** Announced when a head advance closes the open pre-ready check. */
export const MARK_READY_GATE_CLOSED_REASON =
  "This pull request has newer commits — switch to the latest revision to mark it ready for review.";

/** Announced when the own-draft state ends while the pre-ready check is open. */
export const MARK_READY_EXIT_ANNOUNCEMENT =
  "This pull request is now ready for review — the pre-ready check closed.";

export interface UseMarkReadyFlowInput {
  /**
   * The route's mark-ready transport (`ownDraft.markReady`); ABSENT while a
   * historical revision is in view — the CTA then stays focusable and a
   * click announces why (the BRIEF-24 disabled-with-reason pattern).
   */
  action: MarkReadyAction | undefined;
  /** Page-level live-region channel (clear-then-set). */
  announce: (message: string) => void;
  briefId: string;
  /**
   * Closes every reviewer overlay (drawers, pre-submit, disposition modals)
   * when the own-draft state is entered — must be referentially stable.
   */
  closeReviewerOverlays: () => void;
  /** The current head's risk-flag count (the gate's first OPEN condition). */
  flagCount: number;
  /** The rendered Brief's intent check (the gate's soft-gate lines). */
  intentCheck: IntentCheck | undefined;
  jumpToChunk: (chunkId: string) => void;
  /** The plan's presence IS the state (BRIEF-43, ADR 0031). */
  ownDraftActive: boolean;
  /** The own-draft flow's single per-comment post path (the batch awaits it). */
  postDraft: (
    comment: ReviewComment,
    batchOwnsMessaging?: boolean,
  ) => Promise<PostDraftOutcome>;
  /** The session's comments — unposted drafts derive here (gate reminder). */
  reviewComments: ReviewComment[];
  /** THIS render's reviewer-overlay-open snapshot (entry focus rescue). */
  reviewerOverlayOpen: boolean;
  /** Lands on the expanded intent bar (the screen owns the bar's handle). */
  showIntentBar: () => void;
}

export interface UseMarkReadyFlowValue {
  /** False on a historical revision — the CTA explains instead of acting. */
  available: boolean;
  pending: boolean;
  /** The Header CTA's entry point: gate, direct action, or explanation. */
  request: () => void;
  gateOpen: boolean;
  closeGate: () => void;
  /** The gate's confirm: batch-post drafts first when opted in. */
  markReadyAnyway: () => void;
  /** The running batch's progress label ("Posting 2 of 3…"), if any. */
  batchBusyLabel: string | undefined;
  /** The gate's opt-in post-my-drafts checkbox (default unchecked). */
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
  const {
    action,
    announce,
    briefId,
    closeReviewerOverlays,
    flagCount,
    intentCheck,
    jumpToChunk,
    ownDraftActive,
    postDraft,
    reviewComments,
    reviewerOverlayOpen,
    showIntentBar,
  } = input;
  const [markReadyGateOpen, setMarkReadyGateOpen] = useState(false);
  // Default UNCHECKED — posting is an outward write.
  const [postDraftsOnReady, setPostDraftsOnReady] = useState(false);
  const [markReadyBatch, setMarkReadyBatch] = useState<{
    current: number;
    total: number;
  } | null>(null);

  const markReadyFlow = useMarkReady({ action, announce });
  // Entering the own-draft state closes every reviewer overlay: the overlays
  // unmount, but their open flags are plain local state — left set, they keep
  // `shortcutsDisabled` stuck true and resurrect the overlay once the PR is
  // marked ready. A PrView can flip INTO own-draft mid-session, so this is a
  // real path. Focus rescue: the unmount already dropped focus on <body> (no
  // blur fires); the overlay-open snapshot rides a latest-ref (this render's
  // value — resets land next render) and orphaned focus is re-homed on the
  // terminal-slot CTA, with the live region explaining the change.
  const overlayWasOpenRef = useLatestRef(reviewerOverlayOpen);
  const gateOpenRef = useLatestRef(markReadyGateOpen);
  useEffect(() => {
    if (!ownDraftActive) {
      // Exit mirror of the entry path: close the gate (a left-set flag sticks
      // `shortcutsDisabled` and resurrects the gate on a later draft flip);
      // if it was open, rescue the focus its unmount dropped and say why.
      setMarkReadyGateOpen(false);
      if (gateOpenRef.current) {
        const activeAtExit = document.activeElement;
        if (activeAtExit === null || activeAtExit === document.body) {
          document.querySelector<HTMLElement>("[data-terminal-slot]")?.focus();
        }
        announce(MARK_READY_EXIT_ANNOUNCEMENT);
      }
      return;
    }
    const active = document.activeElement;
    if (
      overlayWasOpenRef.current &&
      (active === null || active === document.body)
    ) {
      document.querySelector<HTMLElement>("[data-terminal-slot]")?.focus();
      announce(OWN_DRAFT_ENTRY_ANNOUNCEMENT);
    }
    closeReviewerOverlays();
  }, [
    announce,
    closeReviewerOverlays,
    gateOpenRef,
    overlayWasOpenRef,
    ownDraftActive,
  ]);
  const unpostedDraftComments = useMemo(
    () => reviewComments.filter((comment) => comment.status === "draft"),
    [reviewComments],
  );
  const markReadyAvailable = action !== undefined;
  // Mid-gate head advance: the route withholds `markReady` WITHOUT a remount,
  // so the modal unmounts but its open flag would stay set (stuck
  // `shortcutsDisabled`, focus dropped on <body>). Same rescue + announcement
  // pattern as the entry path above.
  useEffect(() => {
    if (!ownDraftActive || markReadyAvailable) return;
    if (!gateOpenRef.current) return;
    setMarkReadyGateOpen(false);
    const active = document.activeElement;
    if (active === null || active === document.body) {
      document.querySelector<HTMLElement>("[data-terminal-slot]")?.focus();
    }
    announce(MARK_READY_GATE_CLOSED_REASON);
  }, [announce, gateOpenRef, markReadyAvailable, ownDraftActive]);
  const requestMarkReady = useCallback(() => {
    // Historical revision: no action/gate — the CTA stays focusable and the
    // click explains itself (disabled-with-reason pattern).
    if (!markReadyAvailable) {
      announce(MARK_READY_HISTORICAL_REASON);
      return;
    }
    // The CTA is aria-disabled (not hard disabled) while pending, so a click
    // still lands here and would reopen the gate over the running mutation.
    if (markReadyFlow.pending) return;
    // The gate opens for risk flags OR unposted drafts — a zero-flag brief
    // with staged drafts must still offer the post-my-drafts checkbox, or the
    // drafts silently stay local while the PR goes ready.
    if (flagCount > 0 || unpostedDraftComments.length > 0) {
      setPostDraftsOnReady(false);
      setMarkReadyGateOpen(true);
      return;
    }
    markReadyFlow.markReady();
  }, [
    announce,
    flagCount,
    markReadyAvailable,
    markReadyFlow,
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
  // Navigation aid only — posting stays manual (no auto-post).
  const jumpToDraftsFromGate = useCallback(() => {
    setMarkReadyGateOpen(false);
    const first = unpostedDraftComments[0];
    if (first) jumpToChunk(first.anchor.chunkId);
  }, [jumpToChunk, unpostedDraftComments]);
  // Intent lines never feed the gate's OPEN condition.
  const intentGapCount = countIntentGaps(intentCheck);
  const intentTensionCount = countIntentTensions(intentCheck);
  // From the changes-only compare view the bar stays unmounted and the expand
  // no-ops; leaving that mode is the user's action.
  const jumpToIntentGapsFromGate = useCallback(() => {
    setMarkReadyGateOpen(false);
    showIntentBar();
  }, [showIntentBar]);
  // Batch posts each unposted draft SEQUENTIALLY through the SAME per-comment
  // path (no second posting path) and marks ready ONLY if every post
  // succeeded; any failure STOPS before mark-ready. The confirm CTA is
  // aria-disabled while the batch runs, so a click can land before the busy
  // state renders — the re-entrancy guard must be a ref, not state.
  const batchInFlight = useRef(false);
  const runMarkReadyBatch = useCallback(
    async (drafts: readonly ReviewComment[]) => {
      if (batchInFlight.current) return;
      batchInFlight.current = true;
      try {
        const total = drafts.length;
        let posted = 0;
        for (const draft of drafts) {
          setMarkReadyBatch({ current: posted + 1, total });
          // Sequential BY DESIGN: a failure must STOP the run before the next
          // outward write and before mark-ready — Promise.all would defeat
          // the stop-on-failure contract.
          // eslint-disable-next-line no-await-in-loop
          const outcome = await postDraft(draft, true);
          if (outcome !== "posted") {
            setMarkReadyBatch(null);
            setMarkReadyGateOpen(false);
            // Batch entries drain silently; the summary rides the settled
            // queue as a NOTICE, announced LAST by whichever mount is live —
            // announcing from this closure would target the mount that
            // STARTED the batch and a remount-mid-batch would drop it.
            recordPostNotice(
              briefId,
              markReadyBatchFailureCopy(posted, total, outcome),
            );
            // The closing modal may hold focus and NEITHER sibling rescue
            // fires here (no state exit, no head advance) — re-home dropped
            // or stranded focus onto the terminal-slot CTA after the close
            // commits.
            window.requestAnimationFrame(() => {
              const active = document.activeElement;
              if (
                active === null ||
                active === document.body ||
                active.closest('[data-state="closed"]') !== null
              ) {
                document
                  .querySelector<HTMLElement>("[data-terminal-slot]")
                  ?.focus();
              }
            });
            return;
          }
          posted += 1;
        }
        setMarkReadyBatch(null);
        setMarkReadyGateOpen(false);
        // All posted → mark ready; its result copy is the terminal
        // live-region write (batch entries drained silently).
        markReadyFlow.markReady();
      } finally {
        batchInFlight.current = false;
      }
    },
    [briefId, markReadyFlow, postDraft],
  );
  const markReadyAnyway = useCallback(() => {
    if (postDraftsOnReady && unpostedDraftComments.length > 0) {
      void runMarkReadyBatch(unpostedDraftComments);
      return;
    }
    setMarkReadyGateOpen(false);
    markReadyFlow.markReady();
  }, [
    markReadyFlow,
    postDraftsOnReady,
    runMarkReadyBatch,
    unpostedDraftComments,
  ]);

  return {
    available: markReadyAvailable,
    pending: markReadyFlow.pending,
    request: requestMarkReady,
    gateOpen: markReadyGateOpen,
    closeGate: closeMarkReadyGate,
    markReadyAnyway,
    batchBusyLabel: markReadyBatchBusyLabel(markReadyBatch),
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
