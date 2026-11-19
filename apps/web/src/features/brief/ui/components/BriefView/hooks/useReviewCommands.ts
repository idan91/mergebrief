import { useCallback, useMemo, useRef } from "react";

import { useReviewSubmit } from "@web/features/review/hooks";
import {
  useReviewSession,
  useUnplacedDrafts,
} from "@web/features/review/session";
import type { UnresolvedItem } from "@web/features/review/utils";
import { useLatestRef } from "@web/hooks/useLatestRef";
import type { ReviewPosture } from "../../../hooks/useReviewPosture";
import {
  POST_COMMENT_COPY_KEYS,
  useOwnDraftFlow,
  type UseOwnDraftFlowValue,
} from "../drafts/useOwnDraftFlow";
import {
  useInFlightDraftPosts,
  type InFlightDraftPosts,
} from "../drafts/useInFlightDraftPosts";
import type { IntentBarHandle } from "../IntentBar";
import { INTENT_BAR_ID } from "../IntentBar/consts";
import { useMarkReadyFlow } from "../mark-ready/useMarkReadyFlow";
import { ScrollMotions } from "../scroll-to-target/engine/types";
import { ScrollHistories, ScrollTargetKinds } from "../scroll-to-target/types";
import type { ReviewCommands, UseReviewCommandsInput } from "../types";
import { deriveComposerDisabledReason } from "../utils";

export function useReviewCommands(
  input: UseReviewCommandsInput,
): ReviewCommands {
  const { t, viewStore, session, flow } = input;
  const { postingDisabledReason, announce } = flow;

  const inFlight = useInFlightDraftPosts();
  const submitFlow = useSubmitFlow(input, inFlight);
  const liveSubmit = submitFlow.available;
  const { postDraftComment, posture } = useOwnDraftPosture(
    input,
    inFlight,
    submitFlow.pending,
  );
  const { markReady, intentBarRef } = useMarkReadyWiring(
    input,
    postDraftComment,
  );
  const markViewedFromShortcut = useViewedShortcut(input);

  const { setSubmitOpen } = viewStore.getState().actions;
  const submitFromModal = () => {
    if (postingDisabledReason !== undefined) {
      announce(postingDisabledReason);
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
    session.jumpToChunk(item.targetId);
  };

  return {
    submitFlow,
    liveSubmit,
    markReady,
    intentBarRef,
    posture,
    submitFromModal,
    jumpToSubmitItem,
    markViewedFromShortcut,
  };
}

function useSubmitFlow(
  input: UseReviewCommandsInput,
  inFlight: InFlightDraftPosts,
) {
  const { t, props, session, flow } = input;
  const { actions } = session;
  const { flowStore } = flow;

  const getReviewComment = useCallback(
    () => flowStore.getState().reviewComment,
    [flowStore],
  );
  const unplacedDrafts = useUnplacedDrafts();
  const blockedExternally =
    inFlight.ids.size > 0
      ? t(POST_COMMENT_COPY_KEYS.SUBMIT_WHILE_POSTING)
      : undefined;

  return useReviewSubmit({
    action: props.review?.submitReview,
    briefId: props.reading.briefId,
    outcome: session.reviewOutcome,
    comments: session.reviewComments,
    unplacedDrafts,
    receipt: session.receipt,
    getReviewComment,
    consumeReviewComment: flowStore.getState().actions.consumeReviewComment,
    markSubmitted: (ids) => actions.markCommentsSubmitted(ids),
    recordSubmittedReview: (reviewId) =>
      actions.recordSubmittedReview(reviewId),
    announce: flow.announce,
    invalidateConversation: input.conversationWiring.invalidateConversation,
    closeSubmit: flow.closeSubmit,
    resetOutcome: () => actions.setOutcome("comment"),
    blockedExternally,
    trackWrite: actions.trackWrite,
    flowStore,
    viewerIsAuthor: props.review?.viewerIsAuthor === true,
  });
}

function useOwnDraftPosture(
  input: UseReviewCommandsInput,
  inFlight: InFlightDraftPosts,
  submitPending: boolean,
) {
  const { t, props, ownDraftActive, staleHead, session, flow } = input;
  const postComment = props.review?.ownDraft?.postComment;

  const { postDraftComment } = useOwnDraftFlow({
    actions: session.actions,
    announce: flow.announce,
    inFlight,
    invalidateConversation: input.conversationWiring.invalidateConversation,
    postComment,
    submitPending,
  });

  const composerDisabledReason = deriveComposerDisabledReason(
    t,
    flow.writesDisabledReason,
    ownDraftActive && staleHead,
  );
  const flagsReadOnly = ownDraftActive || flow.writesDisabled;
  const postingCommentIds = inFlight.ids;
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

  return { postDraftComment, posture };
}

function useMarkReadyWiring(
  input: UseReviewCommandsInput,
  postDraftComment: UseOwnDraftFlowValue["postDraftComment"],
) {
  const { props, ownDraftActive, viewStore, session, flow } = input;
  const { brief, model } = props.reading;
  const { flowStore } = flow;
  const flowActions = flowStore.getState().actions;
  const { setSubmitOpen } = viewStore.getState().actions;

  const reviewerOverlayOpen = flow.submitOpen || input.riskModalOpen;
  const closeReviewerOverlays = useCallback(() => {
    setSubmitOpen(false);
    flowActions.setDismissTarget(null);
    flowActions.setEvidenceTarget(null);
  }, [flowActions, setSubmitOpen]);

  // The bar mounts with the story view, so its expand waits a task; the
  // scroll to target waits for the mount on its own.
  const intentBarRef = useRef<IntentBarHandle>(null);
  const { exitToStoryView, scrollToTarget } = session;
  const showIntentBar = useCallback(() => {
    exitToStoryView();
    window.setTimeout(() => intentBarRef.current?.expand(), 0);
    scrollToTarget(
      { kind: ScrollTargetKinds.SECTION, sectionId: INTENT_BAR_ID },
      { motion: ScrollMotions.SMOOTH, history: ScrollHistories.NONE },
    );
  }, [exitToStoryView, scrollToTarget]);

  const markReady = useMarkReadyFlow({
    action: props.review?.ownDraft?.markReady,
    announce: flow.announce,
    viewStore,
    closeReviewerOverlays,
    flagCount: model.flags.length,
    intentCheck: brief.intentCheck,
    jumpToChunk: session.jumpToChunk,
    chunks: session.readingOrderedChunks,
    ownDraftActive,
    postDraft: postDraftComment,
    reviewComments: session.reviewComments,
    reviewerOverlayOpen,
    showIntentBar,
    phoneControlsRef: input.phoneControlsRef,
  });

  return { markReady, intentBarRef };
}

function useViewedShortcut({ t, session, flow }: UseReviewCommandsInput) {
  const { writesDisabledReason, announce } = flow;
  const reviewedChunks = useReviewSession((state) => state.reviewedChunks);
  const reviewedChunksRef = useLatestRef(reviewedChunks);

  return (chunkId: string) => {
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
}
