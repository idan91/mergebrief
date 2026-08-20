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
} from "../utils/submit";

export interface UseReviewSubmitInput {
  /** The DB route's transport; `undefined` on the local demo path. */
  action: SubmitReviewAction | undefined;
  /** Keys the durable submitted-flip in sessionStorage on success. */
  briefId: string;
  outcome: ReviewOutcome;
  comments: ReviewComment[];
  receipt: Receipt;
  /**
   * Reads the reviewer's free-text review comment. A GETTER, not the string:
   * the draft changes per keystroke and the owning screen must not re-render
   * with it — the editing surface subscribes to the raw text itself.
   */
  getReviewComment: () => string;
  /**
   * Clears the review-comment draft after a successful submit — called with
   * the text CAPTURED at click time, so the owner can keep an edit made
   * while the request was in flight.
   */
  consumeReviewComment: (sent: string) => void;
  /**
   * Flips exactly the given comment ids to `submitted` — the hook passes the
   * draft ids it CAPTURED at click time, so a draft added or edited while
   * the request was in flight is never falsely marked as posted.
   */
  markSubmitted: (ids: readonly string[]) => void;
  /**
   * Records the created review id — the own-comment join key for
   * conversation reconciliation.
   */
  recordSubmittedReview: (reviewId: number) => void;
  /**
   * Page-level live-region channel (the toast) — carries success AND failure
   * copy, because the drawer that renders the inline error may already be
   * closed (and inert) by the time the request settles.
   */
  announce: (message: string) => void;
  /**
   * Refetches the live conversation after a successful submit. Undefined off
   * the DB path. Local submitted cards keep rendering until the refetched
   * threads actually contain them (GitHub's read-after-write lag).
   */
  invalidateConversation: (() => void) | undefined;
  closeSubmit: () => void;
  /**
   * Resets the session outcome to `comment` after a VERDICT was delivered —
   * a follow-up submit defaults to a comment-only review instead of posting
   * the same approval/request-changes again.
   */
  resetOutcome: () => void;
  /**
   * A screen-owned reason Submit must not proceed right now, folded into
   * `blockedReasonWith` and hard-guarding `submit()` itself — e.g. a post-now
   * request still in flight, where the capture would ship a still-draft
   * comment that the settling 201 then flips (duplicate on GitHub).
   */
  blockedExternally?: string | undefined;
}

export interface UseReviewSubmitValue {
  /** False on the local demo path — the caller keeps its mock behavior. */
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
  // One memoized object so the submit callback takes a single stable dep
  // instead of ten string members.
  const COPY = useMemo(
    () => ({
      posted: t("review.submitResult.posted"),
      postedDegraded: t("review.submitResult.postedDegraded"),
      degradedNote: t("review.submitResult.anchorsFolded"),
      rewritten: t("review.submitResult.rewritten"),
      orphanedDraft: t("review.submitResult.orphanedDraft"),
      unauthorized: t("review.submitResult.unauthorized"),
      notFound: t("review.submitResult.notFound"),
      invalid: t("review.submitResult.invalid"),
      upstreamNeutral: t("review.submitResult.upstream"),
      upstreamVerdict: t("review.submitResult.ownPr"),
      // Deliberately INDETERMINATE: a throw can land after the POST reached
      // GitHub, so this copy must not claim "nothing was posted".
      failed: t("review.submitResult.indeterminate"),
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
  // The brief can change UNDER a live request now that the subtree survives
  // revision steps: settle-time writes compare the click-time briefId against
  // this live ref, and live-store/display writes stand down on a mismatch —
  // ids collide across revisions, so an unguarded markSubmitted would flip
  // the SUCCESSOR brief's colliding draft. The durable snapshot write is the
  // originating brief's record and stays unconditional.
  const currentBriefIdRef = useLatestRef(briefId);
  // A previous revision's failure copy (or degradation note) must not render
  // over the new one — same render-phase adjustment as the screen's resets.
  const [displayBriefId, setDisplayBriefId] = useState(briefId);
  if (displayBriefId !== briefId) {
    setDisplayBriefId(briefId);
    setError(null);
    setNote(null);
  }

  // The external block wins the display: it is transient, and the content
  // reasons re-surface once it clears.
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
    // Guard against the CURRENT draft, read at click time — the modal's
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
    // A fresh submit invalidates the previous run's degradation note — it
    // describes THIS submit's outcome only.
    setNote(null);
    // Captured at click time: exactly this set ships, exactly this set flips.
    const drafts = comments.filter((comment) => comment.status === "draft");
    const draftIds = drafts.map((comment) => comment.id);
    // Same capture rule for the review comment: exactly this text ships, and
    // only this text is consumed from the draft on success.
    const reviewCommentAtClick = getReviewComment();
    // Failures land in the inline alert AND the page live region — the
    // drawer may be closed (inert) by the time the request settles.
    const briefCurrent = () => currentBriefIdRef.current === briefId;
    const fail = (copy: string) => {
      // Announce regardless (the outcome concerns the reviewer wherever they
      // are); render the inline copy only while the originating brief shows.
      if (briefCurrent()) setError(copy);
      announce(copy);
    };
    void (async () => {
      try {
        // The transport catch covers ONLY the awaited action: once GitHub
        // reports the review created, a local failure must never be rendered
        // as "nothing was posted".
        let result: Awaited<ReturnType<typeof action>>;
        try {
          result = await action({
            outcome,
            body: buildReviewBody(
              reviewCommentAtClick,
              buildSignatureLine(receipt, drafts.length),
            ),
            comments,
          });
        } catch {
          fail(COPY.failed);
          return;
        }
        switch (result.kind) {
          case "submitted": {
            // A delivered verdict is spent: the follow-up submit defaults to
            // a comment-only review, never a repeat approval.
            const verdictDelivered = outcome !== "comment";
            // Live-store writes only while the store still holds the
            // originating brief.
            if (briefCurrent()) {
              // Consume first: a stale review-comment draft surviving here
              // would prefill the next submit with already-posted text.
              consumeReviewComment(reviewCommentAtClick);
              markSubmitted(draftIds);
              recordSubmittedReview(result.reviewId);
              if (verdictDelivered) {
                resetOutcome();
              }
            }
            closeSubmit();
            // Live on GitHub now — refetch so posted comments render as
            // their real threads.
            invalidateConversation?.();
            if (result.commentsDegraded) {
              if (briefCurrent()) setNote(COPY.degradedNote);
              announce(COPY.postedDegraded);
            } else {
              announce(COPY.posted);
            }
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
