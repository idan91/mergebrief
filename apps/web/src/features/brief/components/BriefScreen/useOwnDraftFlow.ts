// The own-draft post-now facade hook (BRIEF-43 via the BRIEF-44 split, plan
// decision 11): per-comment "post this draft NOW" against GitHub, plus the
// module-registry choreography that makes it remount-safe — the settled-post
// drain and the double-post guards in both directions against a Submit
// review in flight. The screen wires props in; the hook owns the outcome
// copy and returns the single per-comment post path.
import { useCallback, useEffect } from "react";

import type {
  CommentAnchor,
  ReviewComment,
} from "@web/features/review/comments";
import { postCommentBlockedReason } from "@web/features/review/comments";
import type { MindMapActions } from "@web/features/review/session";
import {
  applySettledPosts,
  beginInFlightPost,
  commitPostedComment,
  endInFlightPost,
  recordFailedPost,
  type PostCommentResult,
} from "@web/features/pulls/postComment";

/** Toast copy for per-comment post-now (BRIEF-43): failures always keep the draft. */
export const POST_COMMENT_COPY = {
  posted: "Comment posted to GitHub.",
  unauthorized:
    "Your GitHub session expired — sign in again to post this comment.",
  notFound: "This pull request is no longer accessible on GitHub.",
  stale:
    "The pull request has newer commits — reload to post this comment against the current diff.",
  // A deterministic route reject: retrying the SAME draft can never succeed
  // (unlike `upstream`), so this copy asks for an edit, never a plain retry.
  invalid:
    "This comment couldn't be posted as sent — edit the draft and post again.",
  upstream:
    "GitHub rejected the request or is unreachable — your draft is kept, try again shortly.",
  // Deliberately INDETERMINATE (useReviewSubmit's discipline): the catch can
  // land AFTER the POST reached GitHub (connection drop mid-response,
  // malformed 201) — with the draft never flipped, a confident retry prompt
  // could double-post, and the still-draft record would re-ship on the next
  // Submit review on top of that.
  failed:
    "Something went wrong posting this comment — it may or may not have posted. Check the pull request on GitHub before retrying.",
  // Blocks Submit review while any post-now is settling (same-tab re-ship
  // window: the payload capture would ship the still-draft comment, and the
  // 201 would flip it only after the review re-shipped it).
  submitWhilePosting:
    "A comment is still posting to GitHub — wait for it to finish before submitting the review.",
  // The symmetric block: a Submit review in flight already CAPTURED the
  // drafts, so posting one now would double-post it when the review lands.
  postWhileSubmitting:
    "A review is being submitted — wait for it to finish before posting this comment.",
} as const;

/**
 * How a single batch post ended (reviewer rounds 2–3): every value except
 * `posted`/`indeterminate` is a DETERMINISTIC stop-cause — the comment
 * definitively did NOT post — carried granularly because in a batch the
 * per-comment copy is suppressed and the summary is the ONLY message, so it
 * must give the cause's own recovery (round 3 #2):
 * - `rejected`   — guard rejection or invalid 400: edit the draft;
 * - `unauthorized` — session expired: sign in again;
 * - `stale`      — head advanced under the pinned commit: reload;
 * - `not-found`  — the PR is no longer accessible;
 * - `indeterminate` — failure AROUND the write (thrown mid-flight, upstream
 *   unreachable, duplicate in-flight): may or may not have reached GitHub.
 */
export type PostDraftOutcome =
  | "posted"
  | "rejected"
  | "unauthorized"
  | "stale"
  | "not-found"
  | "indeterminate";

export interface UseOwnDraftFlowInput {
  /** The live session store's actions — the drain flips through these. */
  actions: MindMapActions;
  /** Page-level live-region channel (clear-then-set) for outcome copy. */
  announce: (message: string) => void;
  briefId: string;
  /**
   * Refetches the conversation after a posted inline comment (a conversation
   * write — the new thread must render). Absent on the local path.
   */
  invalidateConversation: (() => void) | undefined;
  /** The route's post-now transport (`ownDraft.postComment`); absent hides Post. */
  postComment:
    | ((anchor: CommentAnchor, body: string) => Promise<PostCommentResult>)
    | undefined;
  /** The module registry's per-brief in-flight view (screen-subscribed). */
  postingCommentIds: ReadonlySet<string>;
  /** A Submit review in flight already captured the drafts — posting blocks. */
  submitPending: boolean;
}

export interface UseOwnDraftFlowValue {
  /**
   * Posts one staged draft NOW as a standalone inline review comment and
   * returns the post's OUTCOME (posted / deterministic reject /
   * indeterminate) — the single per-comment path reused by both the inline
   * Post button (fire-and-forget: the return is ignored) and the mark-ready
   * batch (awaited sequentially; the outcome branches the summary's
   * stop-cause copy — reviewer round 2 #2).
   */
  postDraftComment: (
    comment: ReviewComment,
    batchOwnsMessaging?: boolean,
  ) => Promise<PostDraftOutcome>;
}

export function useOwnDraftFlow(
  input: UseOwnDraftFlowInput,
): UseOwnDraftFlowValue {
  const {
    actions,
    announce,
    briefId,
    invalidateConversation,
    postComment,
    postingCommentIds,
    submitPending,
  } = input;

  // Drain settled posts into THIS mount (reviewer rounds 7/8): the settling
  // closure captured the store AND toast of the mount that STARTED the post —
  // after a same-tab remount both are orphans, so the flip must apply through
  // whichever store is live at settle time, and EVERY outcome's copy (the
  // indeterminate failure warning above all) must reach the live region that
  // is actually on screen. Runs on mount (drains a settle that landed while
  // no screen was up) and on every in-flight change (a settle notifies the
  // screen's useInFlightPosts subscription, whose new snapshot re-runs this
  // effect via the postingCommentIds dep) — flipping the new
  // store BEFORE its next whole-state flush can clobber the durable snapshot
  // flip, and restoring the "yours" reconciliation join key. Synchronizing
  // with an external system (the module registry), not deriving state — an
  // effect is the right tool.
  useEffect(() => {
    applySettledPosts(briefId, actions, announce);
  }, [actions, announce, briefId, postingCommentIds]);

  // Double-post guard, twice over: the module-level REGISTRY is the
  // synchronous re-entrancy gate (`beginInFlightPost` returns false on a
  // duplicate — module state, so it survives the same-tab remount a ref/state
  // pair dies with), and its subscribed view (`postingCommentIds` above)
  // re-renders so the in-flight comment's Post/Edit/Delete controls visibly
  // disable (a mid-flight edit would flip a `submitted` record whose edited
  // body was never what actually posted). Keyed by comment id so distinct
  // drafts post concurrently but one draft cannot double-fire.
  //
  // Accepted scope (reviewer round 1, 4b): the guard is per-TAB. Two tabs
  // share the same sessionStorage-copied draft ids, so posting the same draft
  // from both tabs can double-post on GitHub — deduping that would need a
  // server-side idempotency key. Accepted for this PR; the second tab's local
  // record still reconciles as "yours" after its next conversation refetch.
  //
  // EVERY outcome is RECORDED on the module-level settled queue, never
  // announced from this closure (reviewer round 8): after a
  // remount-mid-flight, this closure's announce targets the orphaned mount —
  // a React no-op — and a lost failure warning (the indeterminate copy above
  // all) would leave a silently re-enabled Post button inviting a
  // double-posting retry. The drain effect above announces through whichever
  // mount is live.
  //
  // `batchOwnsMessaging` (reviewer round 1 #1): batch-initiated posts queue
  // their settled entries with a NULL copy — the drain still applies every
  // store flip but announces nothing, so the batch's summary toast is
  // deterministically the LAST live-region write. Without it, the summary
  // (announced from the await continuation) was scheduled first and the
  // failed post's drain announcement then overwrote the honest counts and
  // "The PR was NOT marked ready".
  const postDraftComment = useCallback(
    async (
      comment: ReviewComment,
      batchOwnsMessaging = false,
    ): Promise<PostDraftOutcome> => {
      // Guard the injected action's presence, the draft status (a posted
      // comment is server-owned/read-only), and re-entrancy.
      if (postComment === undefined || comment.status !== "draft") {
        return "rejected";
      }
      // Cap mirrors (apps/web AGENTS.md): an over-cap body or anchor path is
      // a deterministic route 400 — the Post button is already disabled with
      // this reason; this guards the programmatic path with the same copy.
      // In a batch the reason is SUPPRESSED (round 2 #1): it would inject
      // noise before the summary, which reports the deterministic stop-cause
      // itself.
      const blocked = postCommentBlockedReason(comment);
      if (blocked !== undefined) {
        if (!batchOwnsMessaging) announce(blocked);
        return "rejected";
      }
      // Reverse race (reviewer round 7 #2, blockedExternally's mirror): a
      // Submit review in flight already CAPTURED this draft — posting it now
      // would double-post it when the review lands. The Post button is
      // disabled with this reason; this guards the programmatic path.
      // Suppressed in a batch on the same terms as the cap mirror above.
      if (submitPending) {
        if (!batchOwnsMessaging) {
          announce(POST_COMMENT_COPY.postWhileSubmitting);
        }
        return "rejected";
      }
      // A duplicate in-flight post: ITS outcome is unknowable from here, so a
      // batch must stop with the indeterminate summary, never a confident
      // "did not post".
      if (!beginInFlightPost(briefId, comment.id)) return "indeterminate";
      try {
        const result = await postComment(comment.anchor, comment.body);
        switch (result.kind) {
          case "posted": {
            // The submit flow's exact success semantics, for one comment:
            // the draft flips to `submitted` (dropping the unposted-draft
            // count the soft gate reminds on — BRIEF-43 #5) and the wrapping
            // review id is recorded ("yours" join, BRIEF-25). The DURABLE
            // snapshot write + settled-queue entry happen here; the LIVE-store
            // flip + announcement apply through the drain effect above — always
            // the mount live at settle time, never the one this closure
            // captured (reviewer round 7 #1).
            commitPostedComment(
              briefId,
              comment.id,
              result.reviewId,
              batchOwnsMessaging ? null : POST_COMMENT_COPY.posted,
            );
            // A posted inline comment is a conversation write — refetch so the
            // new thread renders. The query client is app-level, not
            // mount-level, so invalidating from this closure is remount-safe.
            invalidateConversation?.();
            return "posted";
          }
          case "unauthorized":
            recordFailedPost(
              briefId,
              comment.id,
              batchOwnsMessaging ? null : POST_COMMENT_COPY.unauthorized,
            );
            return "unauthorized";
          case "not-found":
            recordFailedPost(
              briefId,
              comment.id,
              batchOwnsMessaging ? null : POST_COMMENT_COPY.notFound,
            );
            return "not-found";
          case "stale":
            recordFailedPost(
              briefId,
              comment.id,
              batchOwnsMessaging ? null : POST_COMMENT_COPY.stale,
            );
            return "stale";
          // Deterministic reject: distinct copy — a retry of the SAME draft
          // can never succeed, so it must never read as retryable.
          case "invalid":
            recordFailedPost(
              briefId,
              comment.id,
              batchOwnsMessaging ? null : POST_COMMENT_COPY.invalid,
            );
            return "rejected";
          case "upstream":
            recordFailedPost(
              briefId,
              comment.id,
              batchOwnsMessaging ? null : POST_COMMENT_COPY.upstream,
            );
            return "indeterminate";
        }
      } catch (error) {
        console.error("post-now failed", error);
        recordFailedPost(
          briefId,
          comment.id,
          batchOwnsMessaging ? null : POST_COMMENT_COPY.failed,
        );
        return "indeterminate";
      } finally {
        endInFlightPost(briefId, comment.id);
      }
    },
    [announce, briefId, invalidateConversation, postComment, submitPending],
  );

  return { postDraftComment };
}
