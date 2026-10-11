// The GitHub calls around one pending review: open it, attach threads,
// submit it, and delete it when the submit cannot finish. A 401'd create
// made nothing, so a refreshed retry cannot double-post.
import {
  addPullRequestReviewThread,
  countPendingReviewComments,
  createPullRequestReview,
  deletePendingPullRequestReview,
  findPendingPullRequestReview,
  GitHubApiErrorCodes,
  hasPullRequestReviewPublished,
  submitPullRequestReview,
  type GitHubApiError,
  type PendingReview,
  type ReviewEvent,
  type SubmitPullRequestReviewInput,
} from "github";
import type { Mutable, Result } from "types/utils";
import type { TokenUnreadableFailure } from "../../../../../shared-errors/failures";
import type {
  GitHubCallFailed,
  GitHubCallTokenUnreadable,
} from "../../../../auth/reviewer-github-client";
import type {
  PendingReviewHeldFailure,
  PendingReviewResult,
  PostThread,
  PublishDeps,
  PublishTarget,
  SubmitPendingResult,
} from "../types";

export function isPendingReviewHeld(
  error: GitHubApiError | TokenUnreadableFailure | PendingReviewHeldFailure,
): error is PendingReviewHeldFailure {
  return "kind" in error && error.kind === "pending-review-held";
}

function isStalePendingRefusal(
  failure: GitHubCallFailed<GitHubApiError> | GitHubCallTokenUnreadable,
): boolean {
  if (failure.tokenUnreadable) {
    return false;
  }
  return failure.error.code === GitHubApiErrorCodes.PENDING_REVIEW_EXISTS;
}

/**
 * Delete the viewer's pending review a previous request left behind, and
 * only that: one carrying comments is the viewer's own unsent work, on
 * GitHub or from a submit that died mid-way, and comes back as held. A
 * missing one is nothing to clear; a failure to find, count or delete comes
 * back whole.
 */
async function clearStalePendingReview(
  deps: PublishDeps,
  target: PublishTarget,
): Promise<
  Result<
    void,
    GitHubApiError | TokenUnreadableFailure | PendingReviewHeldFailure
  >
> {
  const stale = await deps.github.run((token) =>
    findPendingPullRequestReview(deps.github.createOctokit(token), target),
  );
  if (!stale.ok) {
    return stale;
  }
  const found = stale.value;
  if (found === undefined) {
    return { ok: true, value: undefined };
  }

  const counted = await deps.github.run((token) =>
    countPendingReviewComments(
      deps.github.createOctokit(token),
      found.reviewNodeId,
    ),
  );
  if (!counted.ok) {
    return counted;
  }
  if (counted.value > 0) {
    return {
      ok: false,
      error: { kind: "pending-review-held", commentCount: counted.value },
    };
  }

  return deps.github.run((token) =>
    deletePendingPullRequestReview(deps.github.createOctokit(token), {
      ...target,
      reviewId: found.reviewId,
    }),
  );
}

/** Open the pending review, clearing a stale one and retrying once. */
export async function openPendingReview(
  deps: PublishDeps,
  target: PublishTarget,
): Promise<PendingReviewResult> {
  const create = () =>
    deps.github.run((token) =>
      createPullRequestReview(deps.github.createMutationOctokit(token), target),
    );

  const first = await create();
  if (first.ok || !isStalePendingRefusal(first)) {
    return first;
  }

  const cleared = await clearStalePendingReview(deps, target);
  if (!cleared.ok) {
    return cleared;
  }
  return create();
}

export function createThreadPoster(deps: PublishDeps): PostThread {
  return (thread) =>
    deps.github.run((token) =>
      addPullRequestReviewThread(
        deps.github.createMutationOctokit(token),
        thread,
      ),
    );
}

export async function submitPendingReview(
  deps: PublishDeps,
  pending: PendingReview,
  event: ReviewEvent,
  body: string | undefined,
): Promise<SubmitPendingResult> {
  const submission: Mutable<SubmitPullRequestReviewInput> = {
    reviewNodeId: pending.reviewNodeId,
    event,
  };
  if (body !== undefined) {
    submission.body = body;
  }
  return deps.github.run((token) =>
    submitPullRequestReview(
      deps.github.createMutationOctokit(token),
      submission,
    ),
  );
}

/**
 * A submit whose acknowledgement was lost may still have published the
 * review; the review this request created being listed in a non-pending
 * state is the proof. Reporting that as a retryable failure would post the
 * whole review a second time. A review missing from the list was deleted;
 * a list that cannot be read leaves the answer unknown.
 */
export async function readSubmitLanded(
  deps: PublishDeps,
  target: PublishTarget,
  pending: PendingReview,
): Promise<Result<boolean, GitHubApiError | TokenUnreadableFailure>> {
  return deps.github.run((token) =>
    hasPullRequestReviewPublished(deps.github.createOctokit(token), {
      ...target,
      reviewId: pending.reviewId,
    }),
  );
}

/**
 * Best effort: a pending review that outlives a failed submit makes the next
 * create 422, which the next request clears itself. Logged, never surfaced.
 */
export async function discardPendingReview(
  deps: PublishDeps,
  target: PublishTarget,
  pending: PendingReview,
): Promise<void> {
  const deleted = await deps.github.run((token) =>
    deletePendingPullRequestReview(deps.github.createOctokit(token), {
      ...target,
      reviewId: pending.reviewId,
    }),
  );
  if (!deleted.ok) {
    deps.log.warn("pending review left behind after a failed submit", {
      reviewId: String(pending.reviewId),
      kind: deleted.tokenUnreadable ? deleted.error.kind : deleted.error.code,
    });
  }
}
