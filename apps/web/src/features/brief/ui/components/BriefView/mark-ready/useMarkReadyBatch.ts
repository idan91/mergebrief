import { useTranslation } from "react-i18next";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import type { ReviewComment } from "@web/features/review/utils";
import type { ShownButtonRef } from "../hooks/usePhoneChrome";
import type { BriefViewStore } from "../store";
import {
  PostDraftOutcomes,
  type MarkReadyBatchStop,
  type PostDraftOutcome,
} from "../types";
import {
  deriveMarkReadyStopReason,
  isCurrentMarkReadyBatch,
  markReadyBatchFailureCopy,
  composeMarkReadyStopCopy,
} from "../utils";
import { focusRescueTarget } from "../focus-rescue";

export interface UseMarkReadyBatchInput {
  viewStore: BriefViewStore;
  announce: (message: string) => void;
  markReady: () => void;
  markReadyAvailable: boolean;
  ownDraftActive: boolean;
  postDraft: (
    comment: ReviewComment,
    batchOwnsMessaging?: boolean,
  ) => Promise<PostDraftOutcome>;
  phoneControlsRef: ShownButtonRef;
}

/** What a stopped batch reads to say why it stopped, and where to say it. */
interface BatchStopSignals {
  ownDraftActive: boolean;
  markReadyAvailable: boolean;
  viewStore: BriefViewStore;
  announce: (message: string) => void;
}

export interface UseMarkReadyBatchValue {
  runMarkReadyBatch: (drafts: readonly ReviewComment[]) => Promise<void>;
}

/**
 * The gate's post-my-drafts batch: marks ready only if every post succeeded
 * while the batch stayed current. A failure, a head advance, a ready
 * elsewhere or leaving the Brief stops it before the next post and before
 * mark-ready, with one announcement.
 */
export function useMarkReadyBatch(
  input: UseMarkReadyBatchInput,
): UseMarkReadyBatchValue {
  const { t } = useTranslation();
  const {
    viewStore,
    announce,
    markReady,
    markReadyAvailable,
    ownDraftActive,
    postDraft,
    phoneControlsRef,
  } = input;
  const { startMarkReadyBatch, advanceMarkReadyBatch, closeMarkReadyGate } =
    viewStore.getState().actions;

  // A revision switch swaps the store and an unmount drops it: either way the
  // old Brief's batch must stop before its next post and before mark-ready.
  useLayoutEffect(() => closeMarkReadyGate, [closeMarkReadyGate]);

  // A stopped batch closes the gate while the modal still holds focus. The
  // rescue must run AFTER React commits the close: a requestAnimationFrame is
  // not ordered against the commit, so under load it read the modal as still
  // open and left focus stranded inside an inert dialog.
  const [batchStopRescue, setBatchStopRescue] = useState(false);
  useEffect(() => {
    if (!batchStopRescue) {
      return;
    }
    setBatchStopRescue(false);

    const active = document.activeElement;
    const stranded =
      active === null ||
      active === document.body ||
      active.closest('[data-state="closed"]') !== null ||
      active.closest("[inert]") !== null;
    if (stranded) {
      focusRescueTarget(phoneControlsRef);
    }
  }, [batchStopRescue, phoneControlsRef]);

  // Written in the layout phase with the closes, so a post settling before
  // passive effects flush reads the same render that stopped its batch. A
  // Brief switch swaps the live region with the store; a stopped batch still
  // reports the posts it made on the page now in view.
  const latest = useRef<BatchStopSignals>({
    ownDraftActive,
    markReadyAvailable,
    viewStore,
    announce,
  });
  useLayoutEffect(() => {
    latest.current = {
      ownDraftActive,
      markReadyAvailable,
      viewStore,
      announce,
    };
  });

  const runMarkReadyBatch = useCallback(
    async (drafts: readonly ReviewComment[]) => {
      const total = drafts.length;
      const token = startMarkReadyBatch(total);
      if (token === undefined) {
        return;
      }

      let posted = 0;
      for (const draft of drafts) {
        advanceMarkReadyBatch(token, posted + 1);
        // Sequential BY DESIGN: a stop must land before the next outward
        // write and before mark-ready, Promise.all would defeat it.
        // oxlint-disable-next-line no-await-in-loop
        const outcome = await postDraft(draft, true);
        if (outcome === PostDraftOutcomes.POSTED) {
          posted += 1;
        }
        const current = isCurrentMarkReadyBatch(
          viewStore.getState().markReadyFlow,
          token,
        );
        if (!current) {
          const signals = latest.current;
          const reason = deriveMarkReadyStopReason({
            briefLeft: signals.viewStore !== viewStore,
            ownDraftActive: signals.ownDraftActive,
            markReadyAvailable: signals.markReadyAvailable,
          });
          const stop: MarkReadyBatchStop = { reason, posted, total };
          if (outcome !== PostDraftOutcomes.POSTED) {
            stop.cause = outcome;
          }
          signals.announce(composeMarkReadyStopCopy(t, stop));
          setBatchStopRescue(true);
          return;
        }
        if (outcome !== PostDraftOutcomes.POSTED) {
          closeMarkReadyGate();
          // Per-comment copy is suppressed for the batch, so this summary
          // is the run's only live-region write.
          latest.current.announce(
            markReadyBatchFailureCopy(t, posted, total, outcome),
          );
          setBatchStopRescue(true);
          return;
        }
      }

      closeMarkReadyGate();
      markReady();
    },
    [
      advanceMarkReadyBatch,
      closeMarkReadyGate,
      markReady,
      postDraft,
      startMarkReadyBatch,
      t,
      viewStore,
    ],
  );

  return { runMarkReadyBatch };
}
