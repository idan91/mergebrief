// The pending review's REST lifecycle around a submit: find the viewer's
// stale one, delete one that will never be submitted. GitHub allows one
// PENDING review per user per PR, and shows a pending review only to its
// author, so with the viewer's own token any PENDING entry in the list is
// theirs.
import type { Octokit } from "octokit";
import { RequestError } from "octokit";
import { z } from "zod";
import {
  mapRequestError,
  unexpectedResponseError,
  type GitHubApiError,
} from "../errors";
import type { Result } from "../types";
import type { PendingReview } from "./review";

export interface PullRequestReviewRef {
  readonly owner: string;
  readonly repo: string;
  readonly prNumber: number;
}

export interface DeletePendingPullRequestReviewInput extends PullRequestReviewRef {
  readonly reviewId: bigint;
}

const PENDING_STATE = "PENDING";
const REVIEWS_PER_PAGE = 100;

const reviewListEntrySchema = z.object({
  id: z.number(),
  node_id: z.string(),
  state: z.string(),
});

/**
 * The viewer's pending review on a PR, `undefined` when there is none. Only
 * the create-review 422 path calls this, to clear a pending review a
 * previous request left behind.
 */
export async function findPendingPullRequestReview(
  octokit: Octokit,
  ref: PullRequestReviewRef,
): Promise<Result<PendingReview | undefined, GitHubApiError>> {
  const context = "find pending pull request review";
  let reviews: unknown[];
  try {
    reviews = await octokit.paginate(octokit.rest.pulls.listReviews, {
      owner: ref.owner,
      repo: ref.repo,
      pull_number: ref.prNumber,
      per_page: REVIEWS_PER_PAGE,
    });
  } catch (error) {
    return { ok: false, error: mapRequestError(error, context) };
  }

  for (const entry of reviews) {
    const parsed = reviewListEntrySchema.safeParse(entry);
    if (!parsed.success || parsed.data.state !== PENDING_STATE) {
      continue;
    }
    // JSON.parse rounds ints past 2^53 before we see them.
    if (!Number.isSafeInteger(parsed.data.id)) {
      return { ok: false, error: unexpectedResponseError(context) };
    }
    return {
      ok: true,
      value: {
        reviewId: BigInt(parsed.data.id),
        reviewNodeId: parsed.data.node_id,
      },
    };
  }
  return { ok: true, value: undefined };
}

/** Delete a pending review; one already gone (404) is a success. */
export async function deletePendingPullRequestReview(
  octokit: Octokit,
  input: DeletePendingPullRequestReviewInput,
): Promise<Result<void, GitHubApiError>> {
  try {
    await octokit.rest.pulls.deletePendingReview({
      owner: input.owner,
      repo: input.repo,
      pull_number: input.prNumber,
      review_id: Number(input.reviewId),
    });
    return { ok: true, value: undefined };
  } catch (error) {
    if (error instanceof RequestError && error.status === 404) {
      return { ok: true, value: undefined };
    }
    return {
      ok: false,
      error: mapRequestError(error, "delete pending pull request review"),
    };
  }
}
