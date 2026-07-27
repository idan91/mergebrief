// The mark-ready facade hook (BRIEF-43/BRIEF-54 via the BRIEF-44 split, plan
// decision 11): the own-draft terminal action. Wraps `useMarkReady` with the
// soft gate (risk flags OR unposted drafts), the opt-in "post my drafts,
// then mark ready" batch, the gate's intent-check lines, and the
// entry/exit/head-advance focus rescues. The screen wires props in; the hook
// owns the gate/batch state and every announcement.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useLatestRef } from "@web/hooks/useLatestRef";
import type { ReviewComment } from "@web/features/review/comments";
import type { MarkReadyAction } from "@web/features/pulls/markReady";
import { recordPostNotice } from "@web/features/pulls/postComment";
import { useMarkReady } from "@web/features/pulls/useMarkReady";
import type { IntentCheck } from "../../types";
import type { RiskFlag } from "../../viewModel";
import type { PostDraftOutcome } from "./useOwnDraftFlow";
import { countIntentGaps, countIntentTensions } from "./utils";

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

/**
 * Batch "post my drafts, then mark ready" failure toast (BRIEF-43 follow-up).
 * Honest counts prefix and the explicit NOT-marked-ready suffix on every
 * variant; the guidance branches on the stop-cause (round 3 #2). The house
 * indeterminate rule ("may or may not have posted — check GitHub") applies
 * only to around-the-write failures, where a confident "not posted" would
 * invite a double-posting retry.
 */
export function markReadyBatchFailureCopy(
  posted: number,
  total: number,
  cause: Exclude<PostDraftOutcome, "posted">,
): string {
  const counts = `Posted ${String(posted)} of ${String(total)}.`;
  const suffix = "The PR was NOT marked ready.";
  switch (cause) {
    case "rejected":
      return `${counts} One comment was rejected before posting — edit the draft and try again. ${suffix}`;
    case "unauthorized":
      return `${counts} One comment could not be posted — your GitHub session expired, sign in again to continue. ${suffix}`;
    case "stale":
      return `${counts} One comment could not be posted — the pull request has newer commits, reload to post against the current diff. ${suffix}`;
    case "not-found":
      return `${counts} One comment could not be posted — this pull request is no longer accessible on GitHub. ${suffix}`;
    case "indeterminate":
      return `${counts} One comment may or may not have posted — check GitHub before retrying. ${suffix}`;
  }
}

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
  // The mark-ready soft gate (BRIEF-43) — own-draft state only.
  const [markReadyGateOpen, setMarkReadyGateOpen] = useState(false);
  // Opt-in batch post-then-ready (BRIEF-43 follow-up): the gate's checkbox
  // state (default UNCHECKED — posting is an outward write), and the running
  // batch's progress that pending-labels the confirm button ("Posting 2 of 3…").
  const [postDraftsOnReady, setPostDraftsOnReady] = useState(false);
  const [markReadyBatch, setMarkReadyBatch] = useState<{
    current: number;
    total: number;
  } | null>(null);

  // Own-draft state (BRIEF-43, ADR 0031): the plan's presence IS the state —
  // derived at read time by the route (draft && viewerIsAuthor), never a
  // self-declared toggle. While active: submit/receipt machinery is hidden
  // (not broken), flags are a read-only mirror, and the terminal-action slot
  // holds Mark ready for review. When the refreshed PrView flips draft=false
  // (mark-ready here, or ready-elsewhere via the pr-view poll), `ownDraft`
  // turns undefined and the affordances vanish — the reviewer view is
  // already fully wired.
  const markReadyFlow = useMarkReady({ action, announce });
  // Entering the own-draft state closes every reviewer overlay. The overlays
  // UNMOUNT while the state holds, but their open flags are plain local
  // state — left set, they would keep `shortcutsDisabled` stuck true for the
  // whole session (dead J/K/Z/?/C with nothing visible) and resurrect the
  // overlay the moment the PR is marked ready. A PrView can flip INTO
  // own-draft mid-session (converted to draft on GitHub under an open
  // overlay), so this is a real path, not just belt-and-braces.
  //
  // Focus rescue: by the time the effect runs, this render already unmounted
  // the overlays — a focus that lived inside one was silently dropped on
  // <body> (an unmounting element fires no blur). The overlay-open snapshot
  // rides a latest-ref (this render's values — the resets below only land
  // next render), and orphaned focus is re-homed on the terminal-slot CTA,
  // mirroring the Header's slot-continuity, with the live region explaining
  // why the screen just changed.
  const overlayWasOpenRef = useLatestRef(reviewerOverlayOpen);
  // This render's gate-open snapshot — consumed by the exit branch below and
  // by the mid-gate head-advance effect further down.
  const gateOpenRef = useLatestRef(markReadyGateOpen);
  useEffect(() => {
    if (!ownDraftActive) {
      // Leaving the own-draft state (mark-ready here or ready-elsewhere)
      // closes the soft gate the same way entering closes the reviewer
      // overlays: the modal unmounts with the state, but a left-set open
      // flag would keep `shortcutsDisabled` stuck true and resurrect the
      // gate if the PR converts back to draft later. If the gate was OPEN at
      // exit, its unmount also dropped the focus it held — rescue it onto
      // the terminal slot (now Receipt) and say why the modal vanished, the
      // entry path's mirror.
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
  // The soft gate (ADR 0009 #3 per ADR 0031): the modal shows iff the current
  // head's Brief carries risk flags — zero flags skips it entirely and the
  // CTA acts directly. The unposted-drafts reminder rides the modal only.
  const unpostedDraftComments = useMemo(
    () => reviewComments.filter((comment) => comment.status === "draft"),
    [reviewComments],
  );
  const markReadyAvailable = action !== undefined;
  // The gate closes whenever its ACTION goes away while the state holds: the
  // author pushes mid-gate, the poll advances meta.headSha, `currentHead`
  // flips and the route withholds `markReady` WITHOUT a remount (the span
  // keys the mount). The modal unmounts via its mount condition, but the
  // open flag is plain local state — left set, `shortcutsDisabled` sticks
  // true for the session and the focus the unmounting modal held drops to
  // <body> silently. Same rescue + announcement pattern as the own-draft
  // entry path. (The state-EXIT reset lives in the entry effect above, which
  // also declares `gateOpenRef`.)
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
    // Historical revision in view: the action (and gate) don't exist here —
    // the CTA stays focusable and the click explains itself through the page
    // live region (BRIEF-24 disabled-with-reason pattern).
    if (!markReadyAvailable) {
      announce(MARK_READY_HISTORICAL_REASON);
      return;
    }
    // In-flight guard for the GATE path: the CTA is aria-disabled (not hard
    // disabled) while pending, so a click still lands here — without this it
    // would reopen the gate over the running mutation, whose "Mark ready
    // anyway" then silently no-ops against the flow's inFlight ref.
    if (markReadyFlow.pending) return;
    // The gate opens for risk flags OR unposted drafts (owner amendment to
    // the Q4 zero-flag bypass): the batch expectation is global — a
    // zero-flag brief with drafts staged must still offer the post-my-drafts
    // checkbox, or the drafts silently stay local while the PR goes ready
    // (live bug, PR 9 test). Direct mark-ready only when BOTH are zero.
    if (flagCount > 0 || unpostedDraftComments.length > 0) {
      // Open the gate with the post-drafts checkbox reset to unchecked.
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
  // The reminder's jump link: land on the first unposted draft's chunk — a
  // navigation aid only, posting stays manual (no auto-post).
  const jumpToDraftsFromGate = useCallback(() => {
    setMarkReadyGateOpen(false);
    const first = unpostedDraftComments[0];
    if (first) jumpToChunk(first.anchor.chunkId);
  }, [jumpToChunk, unpostedDraftComments]);
  // The gate's intent-check lines (BRIEF-54/BRIEF-85) — see `utils.ts`. They
  // never feed the gate's OPEN condition: intent gaps alone never open it.
  const intentGapCount = countIntentGaps(intentCheck);
  const intentTensionCount = countIntentTensions(intentCheck);
  // Close the gate and land on the expanded intent bar (PR 3 handle). The bar
  // lives in the full-compare story view, so exit focus mode and story-view
  // first, then defer the expand until that instrument cluster (re)mounts —
  // mirroring the chunk-scroller's setTimeout(0). From the changes-only
  // compare view (a URL-driven mode the author opted into) the bar stays
  // unmounted and the expand no-ops; leaving that mode is the user's action.
  const jumpToIntentGapsFromGate = useCallback(() => {
    setMarkReadyGateOpen(false);
    showIntentBar();
  }, [showIntentBar]);
  // Batch "post my drafts, then mark ready" (BRIEF-43 follow-up, owner-approved
  // reversal of the grill's no-batch decision). Posts each unposted draft
  // SEQUENTIALLY through the SAME per-comment path (in-flight registry,
  // durable commitPostedComment, settled queue — no second posting path), and
  // marks ready ONLY if every post succeeded. Any failure STOPS before
  // mark-ready: the remaining drafts are left untouched, the gate closes, and
  // an honest-counts toast (indeterminate for the one that failed) fires.
  // Synchronous re-entrancy guard (round 2 #3 fallout): the confirm CTA is
  // aria-disabled — not hard disabled — while the batch runs, so a click can
  // land before the busy state renders; state updates are async, a ref is not
  // (the useMarkReady pattern).
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
          // Sequential BY DESIGN (not parallelizable): each post is an outward
          // GitHub write, and a failure must STOP the run before the next post
          // and before mark-ready — Promise.all would fire them all and defeat
          // the stop-on-failure contract.
          // eslint-disable-next-line no-await-in-loop
          const outcome = await postDraft(draft, true);
          if (outcome !== "posted") {
            setMarkReadyBatch(null);
            setMarkReadyGateOpen(false);
            // The batch owns messaging (round 1 #1): every batch entry drains
            // silently and this summary — honest counts, the indeterminate rule
            // for the failed one, the explicit NOT-marked-ready — rides the
            // settled queue as a NOTICE, announced LAST by whichever mount is
            // live. Announcing from this closure instead would target the mount
            // that STARTED the batch: a remount-mid-batch would silently drop
            // the safety-critical warning (security review, this round).
            recordPostNotice(
              briefId,
              markReadyBatchFailureCopy(posted, total, outcome),
            );
            // Focus rescue (round 3 #1): this close happens while the modal
            // may hold focus (the confirm CTA) — the box goes inert and focus
            // drops to <body>, and NEITHER sibling rescue fires (the own-draft
            // state didn't exit, the head didn't advance). After the close
            // commits, re-home focus that was dropped or stranded inside the
            // now-closed modal onto the terminal-slot CTA, mirroring the
            // sibling effects.
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
        // All posted → mark ready. Same messaging guarantee as the failure
        // path: the batch's entries drain silently, so the mark-ready flow's
        // own result copy is the terminal live-region write — a late
        // per-comment success drain cannot clobber it (round 1 #1).
        markReadyFlow.markReady();
      } finally {
        batchInFlight.current = false;
      }
    },
    [briefId, markReadyFlow, postDraft],
  );
  const markReadyAnyway = useCallback(() => {
    // Checked (N>0) → post every unposted draft first, then mark ready iff all
    // succeed. Unchecked → today's behavior: mark ready, post nothing.
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
    batchBusyLabel:
      markReadyBatch !== null
        ? `Posting ${String(markReadyBatch.current)} of ${String(markReadyBatch.total)}…`
        : undefined,
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
