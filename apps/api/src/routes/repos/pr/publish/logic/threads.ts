// One thread mutation per comment, in order. Sequential by design: GitHub's
// secondary rate limit punishes concurrent mutations, and the loop must stop
// at the first transport failure so the caller can delete the pending review.
// octokit paces every mutation, GraphQL included, at one per second per
// viewer, so a submit costs about N+2 seconds of wall clock.
import { ReviewThreadFailureKinds } from "github";
import type { Result } from "types/utils";
import type {
  PostedThreads,
  PostThread,
  PostThreadsFailure,
  PublishComment,
} from "../types";
import { shapeThreadInput } from "./anchor";

/**
 * Post every comment as a thread on the pending review. A rejected anchor is
 * collected and the loop goes on; anything else stops it and comes back
 * whole for the caller to judge.
 */
export async function postReviewThreads(
  post: PostThread,
  reviewNodeId: string,
  comments: readonly PublishComment[],
): Promise<Result<PostedThreads, PostThreadsFailure>> {
  const landed: PublishComment[] = [];
  const rejected: PublishComment[] = [];

  for (const comment of comments) {
    const posted = await post(shapeThreadInput(reviewNodeId, comment));
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
