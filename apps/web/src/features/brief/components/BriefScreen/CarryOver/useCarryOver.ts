import { useMemo } from "react";

import type { BriefViewModel } from "@web/features/brief/utils";
import {
  getChunkRegions,
  useReviewActions,
  useReviewFlow,
  useReviewSession,
  useReviewSessionActions,
  type ReviewSessionPayload,
} from "@web/features/review/session";
import {
  deriveCarriedItems,
  type CarriedItem,
} from "@web/features/review/utils";
import type { AttentionActionId } from "./AttentionList/utils";

export interface CarryOverParams {
  model: BriefViewModel;
  jumpToItem: (item: CarriedItem) => void;
}

export interface CarryOverView {
  carriedFrom: NonNullable<ReviewSessionPayload["carriedFrom"]>;
  /** The carried items still needing a re-look; empty = the clean receipt. */
  items: CarriedItem[];
  armedDraftId: string | null;
  runAction: (item: CarriedItem, action: AttentionActionId) => void;
}

/**
 * The carry-over row's flow: what carried, what of it still needs a re-look,
 * and the operation each affordance runs. `null` = no row to render at all,
 * which a store with no session (or a first-ever one) always answers.
 */
export function useCarryOver({
  model,
  jumpToItem,
}: CarryOverParams): CarryOverView | null {
  const sessionActions = useReviewSessionActions();
  const flowActions = useReviewActions();
  const comments = useReviewSession((state) => state.reviewComments);
  const dispositions = useReviewSession((state) => state.dispositions);
  const deletedMissingDrafts = useReviewSession(
    (state) => state.deletedMissingDrafts,
  );
  const armedDraftId = useReviewFlow((state) => state.reanchorDraftId);
  const carriedFrom = useReviewSession((state) => state.carriedFrom);
  const attention = useReviewSession((state) => state.attention);

  // Both store fields get a new reference on EVERY comment or disposition
  // action anywhere in the Brief, and almost none of them touch a carried
  // item, so the derivation runs only when one of its inputs actually moved.
  const items = useMemo(
    () =>
      deriveCarriedItems({
        attention,
        chunks: model.groups.flatMap((group) => group.chunks),
        regions: getChunkRegions(model),
        flags: model.flags,
        dispositions,
        comments,
        deletedMissingDrafts,
      }),
    [attention, model, dispositions, comments, deletedMissingDrafts],
  );

  // A first-ever session carried nothing, and neither did a previous one that
  // wrote only an outcome, so a row claiming otherwise is worse than the
  // header's progress alone.
  if (carriedFrom === null || carriedFrom.items === 0) return null;

  // Exhaustive by construction: a new clearing operation the server can send
  // fails to compile here rather than falling through to a wrong one.
  const runners: Record<AttentionActionId, (item: CarriedItem) => void> = {
    "delete-draft-comment": (item) => {
      // An unplaceable draft was never resolved into the store, so the
      // ordinary delete would find nothing to act on and write nothing.
      if (item.unplaceable) {
        sessionActions.deleteMissingDraft(item.actionTargetId);
        return;
      }
      flowActions.cancelComposer();
      sessionActions.deleteComment(item.actionTargetId);
    },
    "reanchor-draft-comment": (item) => {
      flowActions.startReanchor(item.actionTargetId);
      if (armedDraftId !== item.actionTargetId) jumpToItem(item);
    },
    "address-risk": (item) => {
      flowActions.setEvidenceTarget({
        flagIds: [item.actionTargetId],
        label: item.label,
      });
    },
    "dismiss-risk": (item) => {
      flowActions.setDismissTarget({
        flagIds: [item.actionTargetId],
        label: item.label,
      });
    },
  };

  return {
    carriedFrom,
    items,
    armedDraftId,
    runAction: (item, action) => {
      runners[action](item);
    },
  };
}
