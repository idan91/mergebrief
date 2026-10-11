// The calls around one pending review on the viewer's bound repo client:
// open it, attach threads, submit it, and delete it when the submit cannot
// finish. The creates ride the client's retry-off runner, so a renewed
// re-run after a 401 cannot double-post.
import {
  GitHubApiErrorCodes,
  type GitHubCall,
  type GitHubCallFailure,
  type PendingReview,
  type ReviewerRepoClient,
  type ReviewEvent,
  type SubmitPullRequestReviewInput,
} from "github";
import type { Mutable, Result } from "types/utils";
import type {
  CommentPin,
  PendingReviewHeldFailure,
  PendingReviewResult,
  PostThread,
  PublishDeps,
} from "../types";

export function isPendingReviewHeld(
  error: GitHubCallFailure | PendingReviewHeldFailure,
): error is PendingReviewHeldFailure {
  return "kind" in error && error.kind === "pending-review-held";
}

/**
 * Delete the viewer's pending review a previous request left behind, and
 * only that: one carrying comments is the viewer's own unsent work, on
 * GitHub or from a submit that died mid-way, and comes back as held. A
 * missing one is nothing to clear; a failure to find, count or delete comes
 * back whole.
 */
async function clearStalePendingReview(
  repo: ReviewerRepoClient,
  prNumber: number,
): Promise<Result<void, GitHubCallFailure | PendingReviewHeldFailure>> {
  const stale = await repo.findPendingPullRequestReview(prNumber);
  if (!stale.ok) {
    return stale;
  }
  const found = stale.value;
  if (found === undefined) {
    return { ok: true, value: undefined };
  }

  const counted = await repo.countPendingReviewComments(found.reviewNodeId);
  if (!counted.ok) {
    return counted;
  }
  if (counted.value > 0) {
    return {
      ok: false,
      error: { kind: "pending-review-held", commentCount: counted.value },
    };
  }

  return repo.deletePendingPullRequestReview({
    prNumber,
    reviewId: found.reviewId,
  });
}

/** Open the pending review, clearing a stale one and retrying once. */
export async function openPendingReview(
  repo: ReviewerRepoClient,
  pin: CommentPin,
): Promise<PendingReviewResult> {
  const first = await repo.createPullRequestReview(pin);
  if (
    first.ok ||
    first.error.code !== GitHubApiErrorCodes.PENDING_REVIEW_EXISTS
  ) {
    return first;
  }

  const cleared = await clearStalePendingReview(repo, pin.prNumber);
  if (!cleared.ok) {
    return cleared;
  }
  return repo.createPullRequestReview(pin);
}

export function createThreadPoster(repo: ReviewerRepoClient): PostThread {
  return (thread) => repo.addPullRequestReviewThread(thread);
}

export async function submitPendingReview(
  repo: ReviewerRepoClient,
  pending: PendingReview,
  event: ReviewEvent,
  body: string | undefined,
): GitHubCall<void> {
  const submission: Mutable<SubmitPullRequestReviewInput> = {
    reviewNodeId: pending.reviewNodeId,
    event,
  };
  if (body !== undefined) {
    submission.body = body;
  }
  return repo.submitPullRequestReview(submission);
}

/**
 * A submit whose acknowledgement was lost may still have published the
 * review; the review this request created being listed in a non-pending
 * state is the proof. Reporting that as a retryable failure would post the
 * whole review a second time. A review missing from the list was deleted;
 * a list that cannot be read leaves the answer unknown.
 */
export async function readSubmitLanded(
  repo: ReviewerRepoClient,
  prNumber: number,
  pending: PendingReview,
): GitHubCall<boolean> {
  return repo.hasPullRequestReviewPublished({
    prNumber,
    reviewId: pending.reviewId,
  });
}

/**
 * Best effort: a pending review that outlives a failed submit makes the next
 * create 422, which the next request clears itself. Logged, never surfaced.
 */
export async function discardPendingReview(
  deps: PublishDeps,
  prNumber: number,
  pending: PendingReview,
): Promise<void> {
  const deleted = await deps.repo.deletePendingPullRequestReview({
    prNumber,
    reviewId: pending.reviewId,
  });
  if (!deleted.ok) {
    deps.log.warn("pending review left behind after a failed submit", {
      reviewId: String(pending.reviewId),
      kind: deleted.error.code,
    });
  }
}
