// Hono-free. Held drafts reach GitHub one of two ways: post-now sends one
// REST comment, Submit opens a PENDING review, attaches one GraphQL thread
// per comment and submits it with the verdict. Both shape the anchor through
// `readGitHubAnchor`, and every write rides a client with octokit's retry
// off, because a replayed POST or mutation is a duplicate comment.
import { createInlineReviewComment } from "github";
import type { ReviewDraftCommentRow } from "persistence";
import { buildGitHubDeniedResult } from "../../../../shared-errors/failures";
import { OutcomeToEvent } from "./consts";
import { shapeInlineCommentInput, shapePublishComment } from "./logic/anchor";
import { foldCommentsIntoBody } from "./logic/fold";
import {
  createThreadPoster,
  discardPendingReview,
  hasSubmitLanded,
  isPendingReviewHeld,
  openPendingReview,
  submitPendingReview,
} from "./logic/pending-review";
import { postReviewThreads } from "./logic/threads";
import type {
  CommentPublishResult,
  PublishDeps,
  PublishedReview,
  PublishTarget,
  ReviewPublishInput,
  ReviewPublishResult,
} from "./types";

/**
 * Post one held draft as an inline review comment. A 401'd POST created
 * nothing, so the client's refreshed re-run cannot double-post.
 */
export async function publishComment(
  deps: PublishDeps,
  target: PublishTarget,
  draft: ReviewDraftCommentRow,
): Promise<CommentPublishResult> {
  const input = shapeInlineCommentInput(shapePublishComment(draft), target);
  const posted = await deps.github.run((token) =>
    createInlineReviewComment(deps.github.createMutationOctokit(token), input),
  );
  if (!posted.ok) {
    return buildGitHubDeniedResult(posted.error, "mutation");
  }
  return posted;
}

/**
 * Post the held drafts as one review. A thread GitHub rejects is folded into
 * the body; a transport failure after the pending review exists deletes it
 * before returning, so the client's retry starts clean.
 */
export async function publishReview(
  deps: PublishDeps,
  input: ReviewPublishInput,
): Promise<ReviewPublishResult> {
  const { target } = input;
  const comments = input.drafts.map(shapePublishComment);

  const pending = await openPendingReview(deps, target);
  if (!pending.ok) {
    if (isPendingReviewHeld(pending.error)) {
      return { ok: false, error: pending.error };
    }
    return buildGitHubDeniedResult(pending.error, "mutation");
  }

  const threads = await postReviewThreads(
    createThreadPoster(deps),
    pending.value.reviewNodeId,
    comments,
  );
  if (!threads.ok) {
    await discardPendingReview(deps, target, pending.value);
    return buildGitHubDeniedResult(threads.error, "mutation");
  }

  const body = foldCommentsIntoBody(
    input.body,
    threads.value.rejected,
    comments.length,
  );
  const event = OutcomeToEvent[input.outcome];
  const submitted = await submitPendingReview(deps, pending.value, event, body);
  if (!submitted.ok) {
    const landed = await hasSubmitLanded(deps, target, pending.value);
    if (!landed) {
      await discardPendingReview(deps, target, pending.value);
      return buildGitHubDeniedResult(submitted.error, "mutation");
    }
  }

  const value: PublishedReview = {
    reviewId: pending.value.reviewId,
    commentsFolded: threads.value.rejected.length,
    commentsTotal: comments.length,
  };
  return { ok: true, value };
}

/**
 * The review body as it would read if GitHub rejected every anchor: the
 * longest body a submit of these drafts can send.
 */
export function foldEveryDraftIntoBody(
  body: string | undefined,
  drafts: readonly ReviewDraftCommentRow[],
): string | undefined {
  const comments = drafts.map(shapePublishComment);
  return foldCommentsIntoBody(body, comments, comments.length);
}
