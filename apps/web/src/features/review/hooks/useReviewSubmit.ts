// Owns pending/blocked/error/note state and the result-kind copy. The action
// is injected by the DB route; absent action = the local demo path.
import { useTranslation } from "react-i18next";
import { useCallback, useMemo, useRef, useState } from "react";

import { useLatestRef } from "@web/hooks/useLatestRef";

import type { ReviewComment } from "../utils/comments";
import type { Receipt } from "../utils/receipt";
import type { ReviewOutcome } from "../utils/state";
import {
  buildReviewBody,
  buildSignatureLine,
  submitBlockedReason,
  type SubmitReviewAction,
  type SubmitReviewResult,
} from "../utils/submit";

type SubmittedReview = Extract<SubmitReviewResult, { kind: "submitted" }>;

export interface UseReviewSubmitInput {
  /** The DB route's transport; `undefined` on the local demo path. */
  action: SubmitReviewAction | undefined;
  /** Keys the durable submitted-flip in sessionStorage on success. */
  briefId: string;
  outcome: ReviewOutcome;
  comments: ReviewComment[];
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
      posted: t("review.submitResult.posted"),
      rewritten: t("review.submitResult.rewritten"),
      orphanedDraft: t("review.submitResult.orphanedDraft"),
      unauthorized: t("review.submitResult.unauthorized"),
      notFound: t("review.submitResult.notFound"),
      noWriteAccess: t("pulls.briefError.no-repo-write-access"),
      invalid: t("review.submitResult.invalid"),
      upstreamNeutral: t("review.submitResult.upstream"),
      upstreamVerdict: t("review.submitResult.ownPr"),
      // Deliberately INDETERMINATE: a throw can land after the POST reached
      // GitHub, so this copy must not claim "nothing was posted".
      failed: t("review.submitResult.indeterminate"),
      pendingReviewHeld: t("review.submitResult.pendingReviewHeld"),
    }),
    [t],
  );
  const {
    action,
    briefId,
    outcome,
    comments,
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
  } = input;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // Synchronous double-click guard: state updates are async, a ref is not.
  const inFlight = useRef(false);
  // Ids collide across revisions, so settle-time writes compare the click-time
  // briefId against this ref. The durable snapshot write stays unconditional.
  const currentBriefIdRef = useLatestRef(briefId);
  // A previous revision's failure copy (or degradation note) must not render
  // over the new one, same render-phase adjustment as the screen's resets.
  const [displayBriefId, setDisplayBriefId] = useState(briefId);
  if (displayBriefId !== briefId) {
    setDisplayBriefId(briefId);
    setError(null);
    setNote(null);
  }

  const blockedReasonWith = useCallback(
    (reviewComment: string) =>
      blockedExternally ??
      submitBlockedReason(t, outcome, comments, reviewComment),
    [blockedExternally, comments, outcome, t],
  );

  const submit = useCallback(() => {
    if (action === undefined || inFlight.current) {
      return;
    }
    // Guard against the CURRENT draft, read at click time, the modal's
    // rendered blocked state may lag the keystroke.
    if (
      blockedExternally !== undefined ||
      submitBlockedReason(t, outcome, comments, getReviewComment()) !==
        undefined
    ) {
      return;
    }
    inFlight.current = true;
    setPending(true);
    setError(null);
    setNote(null);
    // Captured at click time: exactly this set ships, exactly this set flips.
    const drafts = comments.filter((comment) => comment.status === "draft");
    const draftIds = drafts.map((comment) => comment.id);
    const reviewCommentAtClick = getReviewComment();
    const briefCurrent = () => currentBriefIdRef.current === briefId;
    const fail = (copy: string) => {
      // Announce regardless; render inline only on the originating brief.
      if (briefCurrent()) setError(copy);
      announce(copy);
    };
    const settleSubmitted = (result: SubmittedReview) => {
      // A delivered verdict is spent: never a repeat approval.
      const verdictDelivered = outcome !== "comment";
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
          setNote(t("review.submitResult.anchorsFolded", counts));
        }
        announce(t("review.submitResult.postedDegraded", counts));
      } else {
        announce(COPY.posted);
      }
    };
    void (async () => {
      try {
        // Once GitHub reports the review created, a local failure must never
        // render as "nothing was posted".
        let result: Awaited<ReturnType<typeof action>>;
        try {
          result = await action({
            outcome,
            body: buildReviewBody(
              reviewCommentAtClick,
              buildSignatureLine(receipt, drafts.length),
            ),
          });
        } catch {
          fail(COPY.failed);
          return;
        }
        switch (result.kind) {
          case "submitted": {
            settleSubmitted(result);
            break;
          }
          case "rewritten": {
            fail(COPY.rewritten);
            break;
          }
          case "orphaned-draft": {
            fail(COPY.orphanedDraft);
            break;
          }
          case "unauthorized": {
            fail(COPY.unauthorized);
            break;
          }
          case "not-found": {
            fail(COPY.notFound);
            break;
          }
          case "no-write-access": {
            fail(COPY.noWriteAccess);
            break;
          }
          case "invalid": {
            fail(COPY.invalid);
            break;
          }
          case "upstream": {
            fail(
              outcome === "comment"
                ? COPY.upstreamNeutral
                : COPY.upstreamVerdict,
            );
            break;
          }
          case "indeterminate": {
            fail(COPY.failed);
            break;
          }
          case "pending-review-held": {
            fail(COPY.pendingReviewHeld);
            break;
          }
        }
      } finally {
        inFlight.current = false;
        setPending(false);
      }
    })();
  }, [
    action,
    announce,
    blockedExternally,
    briefId,
    closeSubmit,
    comments,
    consumeReviewComment,
    currentBriefIdRef,
    getReviewComment,
    invalidateConversation,
    markSubmitted,
    outcome,
    receipt,
    recordSubmittedReview,
    resetOutcome,
    COPY,
    t,
  ]);

  const clearError = useCallback(() => setError(null), []);

  return {
    available: action !== undefined,
    pending,
    blockedReasonWith,
    error,
    note,
    submit,
    clearError,
  };
}
