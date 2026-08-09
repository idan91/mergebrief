// The own-draft post-now facade hook: per-comment "post this draft NOW"
// against GitHub, plus the module-registry choreography that makes it
// remount-safe — the settled-post drain and the double-post guards in both
// directions against a Submit review in flight.
import { useCallback, useEffect } from "react";

import type {
  CommentAnchor,
  ReviewComment,
} from "@web/features/review/utils/comments";
import { postCommentBlockedReason } from "@web/features/review/utils/comments";
import type { MindMapActions } from "@web/features/review/session";
import {
  applySettledPosts,
  beginInFlightPost,
  commitPostedComment,
  endInFlightPost,
  recordFailedPost,
  type PostCommentResult,
} from "@web/features/pulls/transport/postComment";

/** Toast copy for per-comment post-now: failures always keep the draft. */
export const POST_COMMENT_COPY = {
  posted: "Comment posted to GitHub.",
  unauthorized:
    "Your GitHub session expired — sign in again to post this comment.",
  notFound: "This pull request is no longer accessible on GitHub.",
  stale:
    "The pull request has newer commits — reload to post this comment against the current diff.",
  // Deterministic route reject: retrying the SAME draft can never succeed
  // (unlike `upstream`) — ask for an edit, never a plain retry.
  invalid:
    "This comment couldn't be posted as sent — edit the draft and post again.",
  upstream:
    "GitHub rejected the request or is unreachable — your draft is kept, try again shortly.",
  // Deliberately INDETERMINATE: the catch can land AFTER the POST reached
  // GitHub — a confident retry prompt could double-post.
  failed:
    "Something went wrong posting this comment — it may or may not have posted. Check the pull request on GitHub before retrying.",
  // Blocks Submit review while a post-now settles: the payload capture would
  // re-ship the still-draft comment.
  submitWhilePosting:
    "A comment is still posting to GitHub — wait for it to finish before submitting the review.",
  // Symmetric block: a Submit review in flight already CAPTURED the drafts —
  // posting one now would double-post when the review lands.
  postWhileSubmitting:
    "A review is being submitted — wait for it to finish before posting this comment.",
} as const;

/**
 * How a single post ended. Every value except `posted`/`indeterminate` is a
 * DETERMINISTIC stop-cause (the comment definitively did NOT post), carried
 * granularly because a batch suppresses per-comment copy and its summary must
 * give the cause's own recovery. `indeterminate` = failure AROUND the write:
 * may or may not have reached GitHub.
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
   * stop-cause copy).
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

  // Drain settled posts into THIS mount: the settling closure captured the
  // store/toast of the mount that STARTED the post — orphans after a same-tab
  // remount — so flips and outcome copy must apply through whichever mount is
  // live at settle time. The per-change re-run is critical: the flip must
  // land before the store's next whole-state flush re-persists a stale
  // snapshot — do not narrow the postingCommentIds dep.
  useEffect(() => {
    applySettledPosts(briefId, actions, announce);
  }, [actions, announce, briefId, postingCommentIds]);

  // Double-post guard: the module-level registry is the synchronous
  // re-entrancy gate (survives the same-tab remount a ref/state pair dies
  // with), keyed by comment id so distinct drafts still post concurrently.
  // Per-TAB only — cross-tab dedupe would need a server-side idempotency key.
  //
  // EVERY outcome is RECORDED on the settled queue, never announced from this
  // closure — after a remount-mid-flight this closure's announce targets the
  // orphaned mount and the failure warning would be lost. With
  // `batchOwnsMessaging`, entries queue a NULL copy so the batch's summary
  // toast is deterministically the LAST live-region write.
  const postDraftComment = useCallback(
    async (
      comment: ReviewComment,
      batchOwnsMessaging = false,
    ): Promise<PostDraftOutcome> => {
      // A posted comment is server-owned/read-only.
      if (postComment === undefined || comment.status !== "draft") {
        return "rejected";
      }
      // Cap mirror: an over-cap body/anchor is a deterministic route 400 —
      // same copy as the disabled Post button, guarding the programmatic
      // path. In a batch the reason is suppressed (the summary owns it).
      const blocked = postCommentBlockedReason(comment);
      if (blocked !== undefined) {
        if (!batchOwnsMessaging) announce(blocked);
        return "rejected";
      }
      // A Submit review in flight already CAPTURED this draft — posting now
      // would double-post when the review lands.
      if (submitPending) {
        if (!batchOwnsMessaging) {
          announce(POST_COMMENT_COPY.postWhileSubmitting);
        }
        return "rejected";
      }
      // A duplicate in-flight post's outcome is unknowable from here — a
      // batch must stop with the indeterminate summary.
      if (!beginInFlightPost(briefId, comment.id)) return "indeterminate";
      try {
        const result = await postComment(comment.anchor, comment.body);
        switch (result.kind) {
          case "posted": {
            // DURABLE snapshot write + settled-queue entry happen here; the
            // LIVE-store flip + announcement apply through the drain effect —
            // always the mount live at settle time, never this closure's.
            commitPostedComment(
              briefId,
              comment.id,
              result.reviewId,
              batchOwnsMessaging ? null : POST_COMMENT_COPY.posted,
            );
            // Conversation write — refetch so the new thread renders. The
            // query client is app-level, so this closure is remount-safe.
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
