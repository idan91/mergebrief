import type { TFunction } from "i18next";
import { useCallback, useEffect } from "react";
import { useStore } from "zustand";

import {
  getComposerHost,
  getReanchorDraftId,
  useCreateReviewFlowStore,
  useDraftCommentCount,
  useReviewSession,
  type ReviewFlowStore,
} from "@web/features/review/session";
import {
  commentLocation,
  findDraftComment,
  type ReviewComment,
} from "@web/features/review/utils";
import { isGuestHost } from "../../../utils/guest-rows";
import { TOAST_VISIBLE_MS } from "@web/components/Toast/consts";
import type {
  BriefReviewFlowState,
  FlowNoticesInput,
  ReviewCapability,
  UseReviewFlowStateInput,
} from "../types";
import {
  deriveConversationReadOnly,
  deriveWritesDisabledReason,
} from "../utils";
import { MAIN_CONTENT_ID } from "@web/utils/main-content";

export function useReviewFlowState({
  t,
  props,
  viewStore,
  session,
  inChangesScope,
}: UseReviewFlowStateInput): BriefReviewFlowState {
  const writePosture = useWritePosture(t, props.review);

  const submitOpen = useStore(viewStore, (state) => state.submitOpen);
  const { setSubmitOpen } = viewStore.getState().actions;
  const openSubmit = () => setSubmitOpen(true);
  const closeSubmit = useCallback(() => setSubmitOpen(false), [setSubmitOpen]);

  const flowStore = useCreateReviewFlowStore(props.reading.briefId);
  useComposerScopeGuard(flowStore, inChangesScope);
  const toast = useStore(flowStore, (state) => state.toast);
  const liveMessage = useStore(flowStore, (state) => state.liveMessage);
  const lineSelection = useStore(flowStore, (state) => state.lineSelection);
  const reanchor = useReanchor(flowStore, session.reviewComments);
  const riskModalOpen = useStore(
    flowStore,
    (state) => state.dismissTarget !== null || state.evidenceTarget !== null,
  );
  useFlowNotices({
    t,
    flowStore,
    toast,
    clearWriteError: session.actions.clearWriteError,
  });

  return {
    ...writePosture,
    ...reanchor,
    submitOpen,
    openSubmit,
    closeSubmit,
    flowStore,
    announce: flowStore.getState().actions.announce,
    toast,
    liveMessage,
    lineSelection,
    riskModalOpen,
  };
}

function useWritePosture(t: TFunction, review: ReviewCapability | undefined) {
  const sessionFrozen = useReviewSession((state) => state.frozen);
  const draftCommentCount = useDraftCommentCount();
  const writesDisabledReason = deriveWritesDisabledReason(
    t,
    review,
    sessionFrozen,
  );

  return {
    writesDisabledReason,
    writesDisabled: writesDisabledReason !== undefined,
    conversationReadOnly: deriveConversationReadOnly(writesDisabledReason),
    draftCommentCount,
  };
}

/**
 * Both panes stay mounted across a scope switch, so a composer hosted by the
 * hidden pane would stay open unseen with the page shortcuts dead behind it.
 */
function useComposerScopeGuard(
  flowStore: ReviewFlowStore,
  inChangesScope: boolean,
): void {
  const flowActions = flowStore.getState().actions;
  useEffect(() => {
    const host = getComposerHost(flowStore.getState().composer);
    const hostOutOfScope =
      host !== undefined && isGuestHost(host) !== inChangesScope;
    if (hostOutOfScope) {
      flowActions.dismissComposer();
    }
  }, [flowActions, flowStore, inChangesScope]);
}

function useReanchor(
  flowStore: ReviewFlowStore,
  reviewComments: ReviewComment[],
) {
  const reanchorDraftId = useStore(flowStore, (state) =>
    getReanchorDraftId(state.composer),
  );
  const reanchorDraft = findDraftComment(reviewComments, reanchorDraftId);
  const reanchorLocation =
    reanchorDraft === undefined ? undefined : commentLocation(reanchorDraft);
  const flowActions = flowStore.getState().actions;
  // The Cancel button leaves with the banner; focus goes to the content it
  // sat above rather than dropping to the body.
  const cancelReanchorFromBanner = () => {
    flowActions.cancelReanchor();
    document.getElementById(MAIN_CONTENT_ID)?.focus({ preventScroll: true });
  };

  return {
    reanchorArmed: reanchorDraft !== undefined,
    reanchorLocation,
    cancelReanchorFromBanner,
  };
}

function useFlowNotices({
  t,
  flowStore,
  toast,
  clearWriteError,
}: FlowNoticesInput): void {
  const flowActions = flowStore.getState().actions;
  useEffect(() => {
    if (!toast) {
      return;
    }
    const timer = window.setTimeout(
      () => flowActions.clearToast(),
      TOAST_VISIBLE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [flowActions, toast]);

  const writeError = useReviewSession((state) => state.writeError);
  const { announce } = flowActions;
  useEffect(() => {
    if (writeError === null) {
      return;
    }
    announce(t(writeError));
    clearWriteError();
  }, [announce, clearWriteError, t, writeError]);
}
