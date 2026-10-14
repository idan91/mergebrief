// Owns pending/blocked/error/note state and the result-kind copy. The action
// is injected by the DB route; absent action = the local demo path.
import { useTranslation } from "react-i18next";
import { useCallback, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";

import { useLatestRef } from "@web/hooks/useLatestRef";

import {
  countDraftComments,
  listDraftComments,
  type ReviewComment,
} from "../utils/comments";
import type { Receipt } from "../utils/receipt";
import { ReviewOutcomes, type ReviewOutcome } from "types";
import type { SessionDraftComment } from "../session/serverState";
import type { ReviewSessionActions } from "../session/store";
import type { ReviewFlowStore } from "../session/flow/store";
import {
  buildReviewBody,
  buildSignatureLine,
  listUnplacedDrafts,
  submitBlockedReason,
  type SubmitReviewAction,
} from "../utils/submit";
import {
  SubmitReviewResultKinds,
  type SubmitReviewResult,
} from "../utils/types";

type SubmittedReview = Extract<
  SubmitReviewResult,
  { kind: typeof SubmitReviewResultKinds.SUBMITTED }
>;

export interface UseReviewSubmitInput {
  /** The DB route's transport; `undefined` on the local demo path. */
  action: SubmitReviewAction | undefined;
  /** Keys the durable submitted-flip in sessionStorage on success. */
  briefId: string;
  outcome: ReviewOutcome;
  comments: ReviewComment[];
  /** Held drafts this Brief has no chunk for; the route posts them too. */
  unplacedDrafts: readonly SessionDraftComment[];
  receipt: Receipt;
  /** A getter, not the string: the owning screen must not re-render per keystroke. */
  getReviewComment: () => string;
  /** Called with the text captured at click time, so an in-flight edit survives. */
  consumeReviewComment: (sent: string) => void;
  /** Ids captured at click time: a draft added mid-flight is never marked posted. */
  markSubmitted: (ids: readonly string[]) => void;
  /** The own-comment join key for conversation reconciliation. */
  recordSubmittedReview: (reviewId: number) => void;
  /** Carries failure copy too: the drawer may be inert by the time it settles. */
  announce: (message: string) => void;
  /** Local submitted cards keep rendering until the refetch contains them. */
  invalidateConversation: (() => void) | undefined;
  closeSubmit: () => void;
  /** A follow-up submit must not re-post the same approval or request-changes. */
  resetOutcome: () => void;
  /** Hard-guards `submit()`: e.g. a post-now in flight would duplicate on GitHub. */
  blockedExternally?: string | undefined;
  /** The session store's write count, held from the request until the flip lands. */
  trackWrite: ReviewSessionActions["trackWrite"];
  /** The per-Brief flow store: the submit copy lives there, so a switch starts clean. */
  flowStore: ReviewFlowStore;
}

export interface UseReviewSubmitValue {
  /** False on the local demo path, the caller keeps its mock behavior. */
  available: boolean;
  pending: boolean;
  /**
   * Why Submit is disabled (reachable text, not hover-only), evaluated
   * against a caller-supplied review-comment draft so the owning screen need
   * not re-render per keystroke. The external block wins over content rules.
   */
  blockedReasonWith: (reviewComment: string) => string | undefined;
  /** The current failure copy; announced assertively where rendered. */
  error: string | null;
  /** Persistent receipt note (anchoring degradation), survives the toast. */
  note: string | null;
  submit: () => void;
  clearError: () => void;
}

export function useReviewSubmit(
  input: UseReviewSubmitInput,
): UseReviewSubmitValue {
  const { t } = useTranslation();
  const COPY = useMemo(
    () => ({
      POSTED: t("review.submitResult.posted"),
      REWRITTEN: t("review.submitResult.rewritten"),
      ORPHANED_DRAFT: t("review.submitResult.orphanedDraft"),
      UNAUTHORIZED: t("review.submitResult.unauthorized"),
      NOT_FOUND: t("review.submitResult.notFound"),
      NO_WRITE_ACCESS: t("pulls.briefError.no-repo-write-access"),
      GITHUB_PERMISSION: t("review.submitResult.githubPermission"),
      INVALID: t("review.submitResult.invalid"),
      UPSTREAM_NEUTRAL: t("review.submitResult.upstream"),
      UPSTREAM_VERDICT: t("review.submitResult.ownPr"),
      // Deliberately INDETERMINATE: a throw can land after the POST reached
      // GitHub, so this copy must not claim "nothing was posted".
      FAILED: t("review.submitResult.indeterminate"),
      PENDING_REVIEW_HELD: t("review.submitResult.pendingReviewHeld"),
      PUBLISH_PENDING: t("review.submitResult.publishPending"),
      PUBLISH_IN_DOUBT: t("review.submitResult.publishInDoubt"),
    }),
    [t],
  );
  const {
    action,
    briefId,
    outcome,
    comments,
    unplacedDrafts,
    receipt,
    getReviewComment,
    consumeReviewComment,
    markSubmitted,
    recordSubmittedReview,
    announce,
    invalidateConversation,
    closeSubmit,
    resetOutcome,
    blockedExternally,
    trackWrite,
    flowStore,
  } = input;
  const [pending, setPending] = useState(false);
  const submitError = useStore(flowStore, (state) => state.submitError);
  const submitNote = useStore(flowStore, (state) => state.submitNote);
  // Synchronous double-click guard: state updates are async, a ref is not.
  const inFlight = useRef(false);
  // Ids collide across revisions, so settle-time writes compare the click-time
  // briefId against this ref. The durable snapshot write stays unconditional.
  const currentBriefIdRef = useLatestRef(briefId);
  // A return to the same brief builds a new flow store, so settle-time copy
  // goes to the store the screen holds now, not the one from the click.
  const currentFlowStoreRef = useLatestRef(flowStore);

  const signatureLine = useMemo(() => {
    const postedCount =
      countDraftComments(comments) + listUnplacedDrafts(unplacedDrafts).length;
    return buildSignatureLine(receipt, postedCount);
  }, [comments, receipt, unplacedDrafts]);

  const blockedReasonWith = useCallback(
    (reviewComment: string) =>
      blockedExternally ??
      submitBlockedReason(t, {
        outcome,
        comments,
        unplacedDrafts,
        reviewComment,
        reviewBody: buildReviewBody(reviewComment, signatureLine),
      }),
    [blockedExternally, comments, outcome, signatureLine, t, unplacedDrafts],
  );

  const submit = useCallback(() => {
    if (action === undefined || inFlight.current) {
      return;
    }
    // Guard against the CURRENT draft, read at click time, the modal's
    // rendered blocked state may lag the keystroke. The guard measures the
    // exact body the action sends.
    const reviewCommentAtClick = getReviewComment();
    const reviewBody = buildReviewBody(reviewCommentAtClick, signatureLine);
    const blockedReason = submitBlockedReason(t, {
      outcome,
      comments,
      unplacedDrafts,
      reviewComment: reviewCommentAtClick,
      reviewBody,
    });
    const blocked =
      blockedExternally !== undefined || blockedReason !== undefined;
    if (blocked) {
      return;
    }
    inFlight.current = true;
    setPending(true);
    const clickFlowActions = flowStore.getState().actions;
    clickFlowActions.setSubmitError("");
    clickFlowActions.setSubmitNote("");
    // Captured at click time: exactly this set ships, exactly this set flips.
    const drafts = listDraftComments(comments);
    const unplacedAtClick = listUnplacedDrafts(unplacedDrafts);
    const draftIds = [...drafts, ...unplacedAtClick].map((draft) => draft.id);
    const briefCurrent = () => currentBriefIdRef.current === briefId;
    const readFlowActions = () =>
      currentFlowStoreRef.current.getState().actions;
    const fail = (copy: string) => {
      // Announce regardless; render inline only on the originating brief.
      if (briefCurrent()) {
        readFlowActions().setSubmitError(copy);
      }
      announce(copy);
    };
    const settleSubmitted = (result: SubmittedReview) => {
      // A delivered verdict is spent: never a repeat approval.
      const verdictDelivered = outcome !== ReviewOutcomes.COMMENT;
      if (briefCurrent()) {
        // Consume first, or the next submit prefills already-posted text.
        consumeReviewComment(reviewCommentAtClick);
        markSubmitted(draftIds);
        recordSubmittedReview(result.reviewId);
        if (verdictDelivered) {
          resetOutcome();
        }
      }
      closeSubmit();
      invalidateConversation?.();
      if (result.commentsFolded > 0) {
        const counts = {
          folded: result.commentsFolded,
          total: result.commentsTotal,
        };
        if (briefCurrent()) {
          readFlowActions().setSubmitNote(
            t("review.submitResult.anchorsFolded", counts),
          );
        }
        announce(t("review.submitResult.postedDegraded", counts));
      } else {
        announce(COPY.POSTED);
      }
    };
    void trackWrite(async () => {
      try {
        // Once GitHub reports the review created, a local failure must never
        // render as "nothing was posted".
        let result: Awaited<ReturnType<typeof action>>;
        try {
          result = await action({ outcome, body: reviewBody });
        } catch {
          fail(COPY.FAILED);
          return;
        }
        switch (result.kind) {
          case SubmitReviewResultKinds.SUBMITTED: {
            settleSubmitted(result);
            break;
          }
          case SubmitReviewResultKinds.REWRITTEN: {
            fail(COPY.REWRITTEN);
            break;
          }
          case SubmitReviewResultKinds.ORPHANED_DRAFT: {
            fail(COPY.ORPHANED_DRAFT);
            break;
          }
          case SubmitReviewResultKinds.UNAUTHORIZED: {
            fail(COPY.UNAUTHORIZED);
            break;
          }
          case SubmitReviewResultKinds.NOT_FOUND: {
            fail(COPY.NOT_FOUND);
            break;
          }
          case SubmitReviewResultKinds.NO_WRITE_ACCESS: {
            fail(COPY.NO_WRITE_ACCESS);
            break;
          }
          case SubmitReviewResultKinds.GITHUB_PERMISSION: {
            fail(COPY.GITHUB_PERMISSION);
            break;
          }
          case SubmitReviewResultKinds.INVALID: {
            fail(COPY.INVALID);
            break;
          }
          case SubmitReviewResultKinds.UPSTREAM: {
            fail(
              outcome === ReviewOutcomes.COMMENT
                ? COPY.UPSTREAM_NEUTRAL
                : COPY.UPSTREAM_VERDICT,
            );
            break;
          }
          case SubmitReviewResultKinds.INDETERMINATE: {
            fail(COPY.FAILED);
            break;
          }
          case SubmitReviewResultKinds.PENDING_REVIEW_HELD: {
            fail(COPY.PENDING_REVIEW_HELD);
            break;
          }
          case SubmitReviewResultKinds.PUBLISH_PENDING: {
            fail(COPY.PUBLISH_PENDING);
            break;
          }
          case SubmitReviewResultKinds.PUBLISH_IN_DOUBT: {
            fail(COPY.PUBLISH_IN_DOUBT);
            break;
          }
        }
      } finally {
        inFlight.current = false;
        setPending(false);
      }
    });
  }, [
    action,
    announce,
    blockedExternally,
    briefId,
    closeSubmit,
    comments,
    consumeReviewComment,
    currentBriefIdRef,
    currentFlowStoreRef,
    flowStore,
    getReviewComment,
    invalidateConversation,
    markSubmitted,
    outcome,
    recordSubmittedReview,
    resetOutcome,
    signatureLine,
    trackWrite,
    unplacedDrafts,
    COPY,
    t,
  ]);

  const clearError = useCallback(
    () => flowStore.getState().actions.setSubmitError(""),
    [flowStore],
  );

  return {
    available: action !== undefined,
    pending,
    blockedReasonWith,
    error: submitError === "" ? null : submitError,
    note: submitNote === "" ? null : submitNote,
    submit,
    clearError,
  };
}
