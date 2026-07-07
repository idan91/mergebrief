// The submit-flow facade hook (BRIEF-23 PR 3): the heavy Brief screen wires
// props in, this hook owns pending/blocked/error/note state and the
// result-kind copy. The action is injected by the DB route; absent action =
// the local demo path (flow unavailable, the mock stays).
import { useCallback, useRef, useState } from "react";

import type { ReviewComment } from "./comments";
import type { Receipt } from "./receipt";
import { markSnapshotCommentsSubmitted } from "./session";
import type { ReviewOutcome } from "./state";
import {
  buildSignatureLine,
  submitBlockedReason,
  type SubmitReviewAction,
} from "./submit";

export interface UseReviewSubmitInput {
  /** The DB route's transport; `undefined` on the local demo path. */
  action: SubmitReviewAction | undefined;
  /** Keys the durable submitted-flip in sessionStorage on success. */
  briefId: string;
  outcome: ReviewOutcome;
  comments: ReviewComment[];
  receipt: Receipt;
  /**
   * Flips exactly the given comment ids to `submitted` — the hook passes the
   * draft ids it CAPTURED at click time, so a draft added or edited while
   * the request was in flight is never falsely marked as posted.
   */
  markSubmitted: (ids: readonly string[]) => void;
  /**
   * Page-level live-region channel (the toast) — carries success AND failure
   * copy, because the drawer that renders the inline error may already be
   * closed (and inert) by the time the request settles.
   */
  announce: (message: string) => void;
  closeReceipt: () => void;
  /**
   * Resets the session outcome to `comment` after a VERDICT was delivered —
   * a follow-up submit defaults to a comment-only review instead of posting
   * the same approval/request-changes again.
   */
  resetOutcome: () => void;
}

export interface UseReviewSubmitValue {
  /** False on the local demo path — the caller keeps its mock behavior. */
  available: boolean;
  pending: boolean;
  /** Why Submit is disabled (reachable text, not hover-only), if it is. */
  blockedReason: string | undefined;
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
    markSubmitted,
    announce,
    closeReceipt,
    resetOutcome,
  } = input;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // Synchronous double-click guard: state updates are async, a ref is not.
  const inFlight = useRef(false);

  const blockedReason = submitBlockedReason(outcome, comments);

  const submit = useCallback(() => {
    if (action === undefined || inFlight.current) {
      return;
    }
    if (submitBlockedReason(outcome, comments) !== undefined) {
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
            body: buildSignatureLine(receipt, drafts.length),
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
              markSubmitted(draftIds);
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
              );
            } catch (persistError) {
              // Best-effort: the review IS on GitHub (sessionStorage quota /
              // security errors land here). Log and keep going — the success
              // copy must not turn into a retry prompt.
              console.error("submit: local persistence failed", persistError);
            }
            closeReceipt();
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
    briefId,
    closeReceipt,
    comments,
    markSubmitted,
    outcome,
    receipt,
    resetOutcome,
  ]);

  const clearError = useCallback(() => setError(null), []);

  return {
    available: action !== undefined,
    pending,
    blockedReason,
    error,
    note,
    submit,
    clearError,
  };
}
