// The submit-flow facade hook (BRIEF-23 PR 3): the heavy Brief screen wires
// props in, this hook owns pending/blocked/error/note state and the
// result-kind copy. The action is injected by the DB route; absent action =
// the local demo path (flow unavailable, the mock stays).
import { useCallback, useRef, useState } from "react";

import type { ReviewComment } from "../utils/comments";
import type { Receipt } from "../utils/receipt";
import { markSnapshotCommentsSubmitted } from "../session";
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
   * Reads the reviewer's free-text review comment (BRIEF-137) — posted above
   * the signature line, separator-fenced; empty = signature-only body (the
   * pre-137 behavior). A GETTER, not the string: the draft changes per
   * keystroke, and the screen that owns this hook must not re-render with it
   * (the store-subscription discipline is booleans/transitions only). The
   * editing surface subscribes to the raw text itself and re-derives its
   * live disabled state via `blockedReasonWith`.
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
   * Records the created review id in the live session store — the
   * own-comment join key for conversation reconciliation (BRIEF-25).
   */
  recordSubmittedReview: (reviewId: number) => void;
  /**
   * Page-level live-region channel (the toast) — carries success AND failure
   * copy, because the drawer that renders the inline error may already be
   * closed (and inert) by the time the request settles.
   */
  announce: (message: string) => void;
  /**
   * Refetches the live conversation after a successful submit so the posted
   * comments render as their GitHub threads (and the local submitted cards
   * demote) without waiting for an unrelated refetch. Undefined off the
   * DB path. The demotion bridges GitHub's read-after-write lag: local
   * cards keep rendering until the refetched threads actually contain them.
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
   * `blockedReasonWith` and hard-guarding `submit()` itself. BRIEF-43: a
   * post-now request still in flight when the own-draft state exits (ready
   * flip mid-request) — the payload capture would ship the still-draft
   * comment, and the settling 201 would flip it AFTER the review already
   * re-shipped it (duplicate on GitHub). Absent → no external block.
   */
  blockedExternally?: string | undefined;
}

export interface UseReviewSubmitValue {
  /** False on the local demo path — the caller keeps its mock behavior. */
  available: boolean;
  pending: boolean;
  /**
   * Why Submit is disabled (reachable text, not hover-only), evaluated
   * against a caller-supplied review-comment draft — the editing surface
   * subscribes to the raw text and re-derives the disabled state per
   * keystroke without re-rendering the owning screen. The external block
   * (transient, wait-shaped) wins over the content rules.
   */
  blockedReasonWith: (reviewComment: string) => string | undefined;
  /** The current failure copy; announced assertively where rendered. */
  error: string | null;
  /** Persistent receipt note (anchoring degradation), survives the toast. */
  note: string | null;
  submit: () => void;
  clearError: () => void;
}

const COPY = {
  posted: "Review posted to GitHub under your account.",
  postedDegraded:
    "Review posted — GitHub couldn't anchor the inline comments to the diff, so they were folded into the review body. Nothing was dropped.",
  degradedNote:
    "Anchors didn't apply on GitHub's side: the inline comments were folded into the review body. Nothing was dropped.",
  rewritten:
    "This pull request was rewritten since you read it — reload to re-read it at the new head. Your drafts are saved locally.",
  unauthorized:
    "Your GitHub session expired — sign in again. Your drafts are saved locally.",
  notFound: "This pull request is no longer accessible on GitHub.",
  invalid: "The review was rejected as invalid — reload and try again.",
  upstreamNeutral:
    "GitHub rejected the review or is unreachable — try again shortly.",
  upstreamVerdict:
    "GitHub rejected the review — note you can't approve or request changes on your own pull request. Try again, or switch the outcome to Comment.",
  // Deliberately INDETERMINATE: a throw can land after the POST reached
  // GitHub (connection drop mid-response, malformed 201), so this copy must
  // not claim "nothing was posted" — a confident retry prompt could
  // double-post.
  failed:
    "Something went wrong submitting the review — it may or may not have posted. Check the pull request on GitHub before retrying.",
} as const;

export function useReviewSubmit(
  input: UseReviewSubmitInput,
): UseReviewSubmitValue {
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

  // The external block wins the display: it is the transient, wait-shaped
  // reason (a post-now settling), and the content reasons re-surface once it
  // clears.
  const blockedReasonWith = useCallback(
    (reviewComment: string) =>
      blockedExternally ??
      submitBlockedReason(outcome, comments, reviewComment),
    [blockedExternally, comments, outcome],
  );

  const submit = useCallback(() => {
    if (action === undefined || inFlight.current) {
      return;
    }
    // Guard against the CURRENT draft, read at click time — the modal's
    // rendered blocked state may lag the keystroke.
    if (
      blockedExternally !== undefined ||
      submitBlockedReason(outcome, comments, getReviewComment()) !== undefined
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
    const fail = (copy: string) => {
      setError(copy);
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
            try {
              // Consume first: unlike the drafts (durable backstop below), a
              // stale review-comment draft surviving a throw here would
              // prefill the next submit with already-posted text.
              consumeReviewComment(reviewCommentAtClick);
              markSubmitted(draftIds);
              recordSubmittedReview(result.reviewId);
              if (verdictDelivered) {
                resetOutcome();
              }
              // Durable writes too: the provider (and its persistence
              // subscriber) may have unmounted while the request was in
              // flight — live-store changes alone would never reach
              // sessionStorage, and a reload would re-ship these drafts and
              // re-arm the verdict.
              markSnapshotCommentsSubmitted(
                briefId,
                draftIds,
                verdictDelivered,
                result.reviewId,
              );
            } catch (persistError) {
              // Best-effort: the review IS on GitHub (sessionStorage quota /
              // security errors land here). Log and keep going — the success
              // copy must not turn into a retry prompt.
              console.error("submit: local persistence failed", persistError);
            }
            closeSubmit();
            // The review is live on GitHub — refetch the conversation so
            // the posted comments render as their real threads.
            invalidateConversation?.();
            if (result.commentsDegraded) {
              setNote(COPY.degradedNote);
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
