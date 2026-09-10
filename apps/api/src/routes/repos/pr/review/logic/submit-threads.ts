// One thread mutation per comment, in order. Sequential by design: GitHub's
// secondary rate limit punishes concurrent mutations, and the loop must stop
// at the first transport failure so the caller can delete the pending review.
// octokit paces every mutation, GraphQL included, at one per second per
// viewer, so a submit costs about N+2 seconds of wall clock.
import {
  ReviewThreadFailureKinds,
  type AddReviewThreadInput,
  type GitHubApiError,
  type ReviewThread,
  type ReviewThreadFailure,
  type Result,
} from "github";
import type { TokenUnreadableFailure } from "../../../../../shared-errors/failures";
import { toThreadInput, type SubmitComment } from "./submit-comments";

/** One thread mutation on the reviewer's token, refresh budget included. */
export type PostThread = (
  input: AddReviewThreadInput,
) => Promise<
  Result<ReviewThread, ReviewThreadFailure | TokenUnreadableFailure>
>;

export interface PostedThreads {
  readonly landed: SubmitComment[];
  readonly rejected: SubmitComment[];
}

export type PostThreadsFailure = GitHubApiError | TokenUnreadableFailure;

/**
 * Post every comment as a thread on the pending review. A rejected anchor is
 * collected and the loop goes on; anything else stops it and comes back
 * whole for the caller to judge.
 */
export async function postReviewThreads(
  post: PostThread,
  reviewNodeId: string,
  comments: readonly SubmitComment[],
): Promise<Result<PostedThreads, PostThreadsFailure>> {
  const landed: SubmitComment[] = [];
  const rejected: SubmitComment[] = [];

  for (const comment of comments) {
    const posted = await post(toThreadInput(reviewNodeId, comment));
    if (posted.ok) {
      landed.push(comment);
      continue;
    }
    const failure = posted.error;
    if (failure.kind === ReviewThreadFailureKinds.ANCHOR_REJECTED) {
      rejected.push(comment);
      continue;
    }
    if (failure.kind === ReviewThreadFailureKinds.REQUEST_FAILED) {
      return { ok: false, error: failure.error };
    }
    return { ok: false, error: failure };
  }

  return { ok: true, value: { landed, rejected } };
}
