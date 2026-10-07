// The own-draft post-now facade hook: per-comment "post this draft NOW"
// against GitHub, with one in-flight request per draft and the double-post
// guards in both directions against a Submit review in flight.
import { useTranslation } from "react-i18next";
import type { TranslationKey } from "i18n";
import { useCallback } from "react";

import {
  postCommentBlockedReason,
  type ReviewComment,
} from "@web/features/review/utils";
import type { ReviewSessionActions } from "@web/features/review/session";
import type { PostCommentResult } from "@web/features/pulls/transport";
import type { InFlightDraftPosts } from "./useInFlightDraftPosts";

/** Toast keys for per-comment post-now: failures always keep the draft. */
export const POST_COMMENT_COPY_KEYS = {
  posted: "brief.postComment.posted",
  unauthorized: "brief.postComment.unauthorized",
  notFound: "brief.postComment.notFound",
  stale: "brief.postComment.stale",
  // Deterministic route reject: retrying the SAME draft can never succeed
  // (unlike `upstream`), ask for an edit, never a plain retry.
  invalid: "brief.postComment.invalid",
  // Deterministic 409s of their own: neither is stale, and neither becomes
  // postable by retrying, so "try again shortly" would invite a pointless
  // re-post.
  orphanedAnchor: "brief.postComment.orphanedAnchor",
  alreadyPublished: "brief.postComment.alreadyPublished",
  upstream: "brief.postComment.upstream",
  // Deliberately INDETERMINATE: the catch can land AFTER the POST reached
  // GitHub, where a confident retry prompt could double-post.
  failed: "brief.postComment.failed",
  // Blocks Submit review while a post-now settles: the payload capture would
  // re-ship the still-draft comment.
  submitWhilePosting: "brief.postComment.submitWhilePosting",
  // Symmetric block: a Submit review in flight already CAPTURED the drafts,
  // posting one now would double-post when the review lands.
  postWhileSubmitting: "brief.postComment.postWhileSubmitting",
} as const satisfies Record<string, TranslationKey>;

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

/** Every non-posted result kind: its copy and the outcome it reports. */
const POST_FAILURES = {
  unauthorized: {
    copy: POST_COMMENT_COPY_KEYS.unauthorized,
    outcome: "unauthorized",
  },
  "not-found": {
    copy: POST_COMMENT_COPY_KEYS.notFound,
    outcome: "not-found",
  },
  stale: { copy: POST_COMMENT_COPY_KEYS.stale, outcome: "stale" },
  "orphaned-anchor": {
    copy: POST_COMMENT_COPY_KEYS.orphanedAnchor,
    outcome: "rejected",
  },
  "already-published": {
    copy: POST_COMMENT_COPY_KEYS.alreadyPublished,
    outcome: "rejected",
  },
  invalid: { copy: POST_COMMENT_COPY_KEYS.invalid, outcome: "rejected" },
  // Definitively not posted, and not a retry: the reader's own account has
  // no write access to this repository.
  "no-write-access": {
    copy: "pulls.briefError.no-repo-write-access",
    outcome: "rejected",
  },
  // Indeterminate: an earlier attempt may have posted it, or still may.
  "publish-pending": {
    copy: "pulls.briefError.draft-publish-pending",
    outcome: "indeterminate",
  },
  "publish-in-doubt": {
    copy: "pulls.briefError.draft-publish-in-doubt",
    outcome: "indeterminate",
  },
  // Indeterminate, not rejected: GitHub may have taken it before failing.
  upstream: { copy: POST_COMMENT_COPY_KEYS.upstream, outcome: "indeterminate" },
} as const satisfies Record<
  Exclude<PostCommentResult["kind"], "posted">,
  { copy: TranslationKey; outcome: PostDraftOutcome }
>;

export interface UseOwnDraftFlowInput {
  /** The live session store's actions, which a posted comment flips through. */
  actions: ReviewSessionActions;
  /** Page-level live-region channel (clear-then-set) for outcome copy. */
  announce: (message: string) => void;
  /**
   * Refetches the conversation after a posted inline comment (a conversation
   * write, the new thread must render). Absent on the local path.
   */
  invalidateConversation: (() => void) | undefined;
  /** The screen's in-flight gate, one post per draft. */
  inFlight: InFlightDraftPosts;
  /** The route's post-now transport (`ownDraft.postComment`); absent hides Post. */
  postComment: ((draftId: string) => Promise<PostCommentResult>) | undefined;
  /** A Submit review in flight already captured the drafts, so posting blocks. */
  submitPending: boolean;
}

export interface UseOwnDraftFlowValue {
  /**
   * Posts one staged draft NOW as a standalone inline review comment and
   * returns the post's OUTCOME (posted / deterministic reject /
   * indeterminate), the single per-comment path reused by both the inline
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
  const { t } = useTranslation();
  const {
    actions,
    announce,
    inFlight,
    invalidateConversation,
    postComment,
    submitPending,
  } = input;

  // Double-post guard, keyed by comment id so distinct drafts still post
  // concurrently. Per-TAB only, since cross-tab dedupe would need a server-side
  // idempotency key. With `batchOwnsMessaging` nothing announces here, so the
  // batch's summary toast is the last live-region write.
  const postDraftComment = useCallback(
    async (
      comment: ReviewComment,
      batchOwnsMessaging = false,
    ): Promise<PostDraftOutcome> => {
      // A posted comment is server-owned/read-only.
      if (postComment === undefined || comment.status !== "draft") {
        return "rejected";
      }
      // Cap mirror: an over-cap body/anchor is a deterministic route 400,
      // same copy as the disabled Post button, guarding the programmatic
      // path. In a batch the reason is suppressed (the summary owns it).
      const blocked = postCommentBlockedReason(t, comment);
      if (blocked !== undefined) {
        if (!batchOwnsMessaging) announce(blocked);
        return "rejected";
      }
      // A Submit review in flight already CAPTURED this draft, posting now
      // would double-post when the review lands.
      if (submitPending) {
        if (!batchOwnsMessaging) {
          announce(t(POST_COMMENT_COPY_KEYS.postWhileSubmitting));
        }
        return "rejected";
      }
      // A duplicate in-flight post's outcome is unknowable from here, and a
      // batch must stop with the indeterminate summary.
      if (!inFlight.begin(comment.id)) return "indeterminate";
      const say = (key: TranslationKey) => {
        if (!batchOwnsMessaging) announce(t(key));
      };
      try {
        const result = await postComment(comment.id);
        if (result.kind === "posted") {
          // The external write is the commit point: flip the posted comment
          // to server-owned and record the wrapping review id (the "yours"
          // join key), then announce.
          actions.markCommentsSubmitted([comment.id]);
          if (result.reviewId !== undefined) {
            actions.recordSubmittedReview(result.reviewId);
          }
          say(POST_COMMENT_COPY_KEYS.posted);
          // Conversation write, refetch so the new thread renders.
          invalidateConversation?.();
          return "posted";
        }
        const failure = POST_FAILURES[result.kind];
        say(failure.copy);
        return failure.outcome;
      } catch (error) {
        console.error("post-now failed", error);
        say(POST_COMMENT_COPY_KEYS.failed);
        return "indeterminate";
      } finally {
        inFlight.end(comment.id);
      }
    },
    [
      actions,
      announce,
      inFlight,
      invalidateConversation,
      postComment,
      submitPending,
      t,
    ],
  );

  return { postDraftComment };
}
