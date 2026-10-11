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
import {
  PostCommentResultKinds,
  type PostCommentResult,
  type PostCommentResultKind,
} from "../../../../model/types";
import type { InFlightDraftPosts } from "./useInFlightDraftPosts";
import { PostDraftOutcomes, type PostDraftOutcome } from "../types";

/** Toast keys for per-comment post-now: failures always keep the draft. */
export const POST_COMMENT_COPY_KEYS = {
  POSTED: "brief.postComment.posted",
  UNAUTHORIZED: "brief.postComment.unauthorized",
  NOT_FOUND: "brief.postComment.notFound",
  STALE: "brief.postComment.stale",
  // Deterministic route reject: retrying the SAME draft can never succeed
  // (unlike `upstream`), ask for an edit, never a plain retry.
  INVALID: "brief.postComment.invalid",
  // Deterministic 409s of their own: neither is stale, and neither becomes
  // postable by retrying, so "try again shortly" would invite a pointless
  // re-post.
  ORPHANED_ANCHOR: "brief.postComment.orphanedAnchor",
  ALREADY_PUBLISHED: "brief.postComment.alreadyPublished",
  GITHUB_PERMISSION: "brief.postComment.githubPermission",
  UPSTREAM: "brief.postComment.upstream",
  // Deliberately INDETERMINATE: the catch can land AFTER the POST reached
  // GitHub, where a confident retry prompt could double-post.
  FAILED: "brief.postComment.failed",
  // Blocks Submit review while a post-now settles: the payload capture would
  // re-ship the still-draft comment.
  SUBMIT_WHILE_POSTING: "brief.postComment.submitWhilePosting",
  // Symmetric block: a Submit review in flight already CAPTURED the drafts,
  // posting one now would double-post when the review lands.
  POST_WHILE_SUBMITTING: "brief.postComment.postWhileSubmitting",
} as const satisfies Record<string, TranslationKey>;

/** Every non-posted result kind: its copy and the outcome it reports. */
const POST_FAILURES = {
  [PostCommentResultKinds.UNAUTHORIZED]: {
    copy: POST_COMMENT_COPY_KEYS.UNAUTHORIZED,
    outcome: PostDraftOutcomes.UNAUTHORIZED,
  },
  [PostCommentResultKinds.NOT_FOUND]: {
    copy: POST_COMMENT_COPY_KEYS.NOT_FOUND,
    outcome: PostDraftOutcomes.NOT_FOUND,
  },
  [PostCommentResultKinds.STALE]: {
    copy: POST_COMMENT_COPY_KEYS.STALE,
    outcome: PostDraftOutcomes.STALE,
  },
  [PostCommentResultKinds.ORPHANED_ANCHOR]: {
    copy: POST_COMMENT_COPY_KEYS.ORPHANED_ANCHOR,
    outcome: PostDraftOutcomes.REJECTED,
  },
  [PostCommentResultKinds.ALREADY_PUBLISHED]: {
    copy: POST_COMMENT_COPY_KEYS.ALREADY_PUBLISHED,
    outcome: PostDraftOutcomes.REJECTED,
  },
  [PostCommentResultKinds.INVALID]: {
    copy: POST_COMMENT_COPY_KEYS.INVALID,
    outcome: PostDraftOutcomes.REJECTED,
  },
  // Definitively not posted, and not a retry: the reader's own account has
  // no write access to this repository.
  [PostCommentResultKinds.NO_WRITE_ACCESS]: {
    copy: "pulls.briefError.no-repo-write-access",
    outcome: PostDraftOutcomes.REJECTED,
  },
  // Definitively not posted: GitHub refused the viewer's own permission.
  [PostCommentResultKinds.GITHUB_PERMISSION]: {
    copy: POST_COMMENT_COPY_KEYS.GITHUB_PERMISSION,
    outcome: PostDraftOutcomes.REJECTED,
  },
  // Indeterminate: an earlier attempt may have posted it, or still may.
  [PostCommentResultKinds.PUBLISH_PENDING]: {
    copy: "pulls.briefError.draft-publish-pending",
    outcome: PostDraftOutcomes.INDETERMINATE,
  },
  [PostCommentResultKinds.PUBLISH_IN_DOUBT]: {
    copy: "pulls.briefError.draft-publish-in-doubt",
    outcome: PostDraftOutcomes.INDETERMINATE,
  },
  // Indeterminate, not rejected: GitHub may have taken it before failing.
  [PostCommentResultKinds.UPSTREAM]: {
    copy: POST_COMMENT_COPY_KEYS.UPSTREAM,
    outcome: PostDraftOutcomes.INDETERMINATE,
  },
} as const satisfies Record<
  Exclude<PostCommentResultKind, typeof PostCommentResultKinds.POSTED>,
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
        return PostDraftOutcomes.REJECTED;
      }
      // Cap mirror: an over-cap body/anchor is a deterministic route 400,
      // same copy as the disabled Post button, guarding the programmatic
      // path. In a batch the reason is suppressed (the summary owns it).
      const blocked = postCommentBlockedReason(t, comment);
      if (blocked !== undefined) {
        if (!batchOwnsMessaging) {
          announce(blocked);
        }
        return PostDraftOutcomes.REJECTED;
      }
      // A Submit review in flight already CAPTURED this draft, posting now
      // would double-post when the review lands.
      if (submitPending) {
        if (!batchOwnsMessaging) {
          announce(t(POST_COMMENT_COPY_KEYS.POST_WHILE_SUBMITTING));
        }
        return PostDraftOutcomes.REJECTED;
      }
      // A duplicate in-flight post's outcome is unknowable from here, and a
      // batch must stop with the indeterminate summary.
      if (!inFlight.begin(comment.id)) {
        return PostDraftOutcomes.INDETERMINATE;
      }
      const say = (key: TranslationKey) => {
        if (!batchOwnsMessaging) {
          announce(t(key));
        }
      };
      try {
        // A session write until the flip below has landed, so a read that
        // began before the post never puts the draft back.
        const result = await actions.trackWrite(async () => {
          const posted = await postComment(comment.id);
          if (posted.kind === PostCommentResultKinds.POSTED) {
            // The external write is the commit point: flip the posted
            // comment to server-owned and record the wrapping review id
            // (the "yours" join key).
            actions.markCommentsSubmitted([comment.id]);
            if (posted.reviewId !== undefined) {
              actions.recordSubmittedReview(posted.reviewId);
            }
          }
          return posted;
        });
        if (result.kind === PostCommentResultKinds.POSTED) {
          say(POST_COMMENT_COPY_KEYS.POSTED);
          // Conversation write, refetch so the new thread renders.
          invalidateConversation?.();
          return PostDraftOutcomes.POSTED;
        }
        const failure = POST_FAILURES[result.kind];
        say(failure.copy);
        return failure.outcome;
      } catch (error) {
        console.error("post-now failed", error);
        say(POST_COMMENT_COPY_KEYS.FAILED);
        return PostDraftOutcomes.INDETERMINATE;
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
