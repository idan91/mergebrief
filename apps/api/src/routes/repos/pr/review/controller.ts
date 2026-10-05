// Hono-free. A submit is three GitHub objects in order: open a PENDING
// review, attach one thread per comment, submit with the verdict. A thread
// GitHub rejects is folded into the body; a transport failure after the
// pending review exists deletes it before returning, so the client's retry
// starts clean. A 401'd create made nothing, so a refreshed retry cannot
// double-post.
import {
  addPullRequestReviewThread,
  countPendingReviewComments,
  createPullRequestReview,
  createUserOctokit,
  deletePendingPullRequestReview,
  findPendingPullRequestReview,
  GitHubApiErrorCodes,
  hasPullRequestReviewPublished,
  ReviewThreadFailureKinds,
  ReviewValidationClasses,
  submitPullRequestReview,
  type CreatePullRequestReviewInput,
  type CreateReviewError,
  type PendingReview,
  type ReviewEvent,
  type ReviewThreadFailure,
  type SubmitPullRequestReviewInput,
} from "github";
import type { Mutable, Result } from "types/utils";
import {
  buildGitHubDeniedResult,
  isTokenUnreadableFailure,
  type TokenUnreadableFailure,
} from "../../../../shared-errors/failures";
import { createMutationOctokit } from "../mutation-octokit";
import {
  foldCommentsIntoBody,
  type SubmitComment,
} from "./logic/submit-comments";
import { postReviewThreads, type PostThread } from "./logic/submit-threads";
import type { PendingReviewHeldFailure, ReviewControllerDeps } from "./types";

interface SubmitReviewInput {
  readonly target: CreatePullRequestReviewInput;
  readonly event: ReviewEvent;
  readonly body: string | undefined;
  readonly comments: readonly SubmitComment[];
}

export interface SubmittedReview {
  readonly reviewId: bigint;
  readonly commentsFolded: number;
  readonly commentsTotal: number;
}

type PendingReviewResult = Result<
  PendingReview,
  CreateReviewError | TokenUnreadableFailure | PendingReviewHeldFailure
>;

function isPendingReviewHeld(
  error: CreateReviewError | TokenUnreadableFailure | PendingReviewHeldFailure,
): error is PendingReviewHeldFailure {
  return "kind" in error && error.kind === "pending-review-held";
}

function isStalePendingRefusal(
  error: CreateReviewError | TokenUnreadableFailure,
): boolean {
  if (isTokenUnreadableFailure(error)) {
    return false;
  }
  return error.validation === ReviewValidationClasses.PENDING_REVIEW_EXISTS;
}

/** A thread call's 401 sits inside `request-failed`; the default predicate cannot see it. */
function isThreadTokenExpired(failure: ReviewThreadFailure): boolean {
  return (
    failure.kind === ReviewThreadFailureKinds.REQUEST_FAILED &&
    failure.error.code === GitHubApiErrorCodes.UNAUTHORIZED
  );
}

/**
 * Delete the viewer's pending review a previous request left behind, and
 * only that: one carrying comments is the viewer's own unsent work, on
 * GitHub or from a submit that died mid-way, and comes back as held. A
 * missing one is nothing to clear; a failure to find, count or delete comes
 * back whole.
 */
async function clearStalePendingReview(
  deps: ReviewControllerDeps,
  target: CreatePullRequestReviewInput,
): Promise<
  Result<
    void,
    CreateReviewError | TokenUnreadableFailure | PendingReviewHeldFailure
  >
> {
  const stale = await deps.github.run((token) =>
    findPendingPullRequestReview(createUserOctokit(token), target),
  );
  if (!stale.ok) {
    return stale;
  }
  const found = stale.value;
  if (found === undefined) {
    return { ok: true, value: undefined };
  }

  const counted = await deps.github.run((token) =>
    countPendingReviewComments(createUserOctokit(token), found.reviewNodeId),
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
    deletePendingPullRequestReview(createUserOctokit(token), {
      ...target,
      reviewId: found.reviewId,
    }),
  );
}

/** Open the pending review, clearing a stale one and retrying once. */
async function openPendingReview(
  deps: ReviewControllerDeps,
  target: CreatePullRequestReviewInput,
): Promise<PendingReviewResult> {
  const create = () =>
    deps.github.run((token) =>
      createPullRequestReview(createMutationOctokit(token), target),
    );

  const first = await create();
  if (first.ok || !isStalePendingRefusal(first.error)) {
    return first;
  }

  const cleared = await clearStalePendingReview(deps, target);
  if (!cleared.ok) {
    return cleared;
  }
  return create();
}

/**
 * A submit whose acknowledgement was lost may still have published the
 * review; the review this request created being listed in a non-pending
 * state is the proof. Reporting that as a retryable failure would post the
 * whole review a second time. A review missing from the list was deleted.
 */
async function hasSubmitLanded(
  deps: ReviewControllerDeps,
  target: CreatePullRequestReviewInput,
  pending: PendingReview,
): Promise<boolean> {
  const probe = await deps.github.run((token) =>
    hasPullRequestReviewPublished(createUserOctokit(token), {
      ...target,
      reviewId: pending.reviewId,
    }),
  );
  return probe.ok && probe.value;
}

/**
 * Best effort: a pending review that outlives a failed submit makes the next
 * create 422, which the next request clears itself. Logged, never surfaced.
 */
async function discardPendingReview(
  deps: ReviewControllerDeps,
  target: CreatePullRequestReviewInput,
  pending: PendingReview,
): Promise<void> {
  const deleted = await deps.github.run((token) =>
    deletePendingPullRequestReview(createUserOctokit(token), {
      ...target,
      reviewId: pending.reviewId,
    }),
  );
  if (!deleted.ok) {
    deps.log.warn("pending review left behind after a failed submit", {
      reviewId: String(pending.reviewId),
      kind: isTokenUnreadableFailure(deleted.error)
        ? deleted.error.kind
        : deleted.error.code,
    });
  }
}

async function submitReview(
  deps: ReviewControllerDeps,
  input: SubmitReviewInput,
) {
  const pending = await openPendingReview(deps, input.target);
  if (!pending.ok) {
    if (isPendingReviewHeld(pending.error)) {
      return { ok: false, error: pending.error } as const;
    }
    return buildGitHubDeniedResult(pending.error, "mutation");
  }

  const postThread: PostThread = (thread) =>
    deps.github.run(
      (token) =>
        addPullRequestReviewThread(createMutationOctokit(token), thread),
      isThreadTokenExpired,
    );
  const threads = await postReviewThreads(
    postThread,
    pending.value.reviewNodeId,
    input.comments,
  );
  if (!threads.ok) {
    await discardPendingReview(deps, input.target, pending.value);
    return buildGitHubDeniedResult(threads.error, "mutation");
  }

  const body = foldCommentsIntoBody(
    input.body,
    threads.value.rejected,
    input.comments.length,
  );
  const submission: Mutable<SubmitPullRequestReviewInput> = {
    reviewNodeId: pending.value.reviewNodeId,
    event: input.event,
  };
  if (body !== undefined) {
    submission.body = body;
  }
  const submitted = await deps.github.run((token) =>
    submitPullRequestReview(createMutationOctokit(token), submission),
  );
  if (!submitted.ok) {
    const landed = await hasSubmitLanded(deps, input.target, pending.value);
    if (!landed) {
      await discardPendingReview(deps, input.target, pending.value);
      return buildGitHubDeniedResult(submitted.error, "mutation");
    }
  }

  const value: SubmittedReview = {
    reviewId: pending.value.reviewId,
    commentsFolded: threads.value.rejected.length,
    commentsTotal: input.comments.length,
  };
  return { ok: true, value } as const;
}

export default { submitReview };
