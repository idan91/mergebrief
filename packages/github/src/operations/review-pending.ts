// The pending review's REST lifecycle around a submit: find the viewer's
// stale one, delete one that will never be submitted. GitHub allows one
// PENDING review per user per PR, and shows a pending review only to its
// author, so with the viewer's own token any PENDING entry in the list is
// theirs.
import type { Octokit } from "octokit";
import { RequestError } from "octokit";
import { z } from "zod/v4";
import {
  mapGraphqlError,
  mapRequestError,
  unexpectedResponseError,
  type GitHubApiError,
} from "../errors";
import type { Result } from "types/utils";
import type { PendingReview } from "./review";
import { HttpStatuses } from "types/http";

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

async function readReviewList(
  octokit: Octokit,
  ref: PullRequestReviewRef,
  context: string,
): Promise<Result<unknown[], GitHubApiError>> {
  try {
    const reviews = await octokit.paginate(octokit.rest.pulls.listReviews, {
      owner: ref.owner,
      repo: ref.repo,
      pull_number: ref.prNumber,
      per_page: REVIEWS_PER_PAGE,
    });
    return { ok: true, value: reviews };
  } catch (error) {
    return { ok: false, error: mapRequestError(error, context) };
  }
}

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
  const listed = await readReviewList(octokit, ref, context);
  if (!listed.ok) {
    return listed;
  }

  for (const entry of listed.value) {
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

/**
 * Whether the review with this id is listed in a state other than PENDING:
 * the proof a submit whose acknowledgement was lost still published it. A
 * review missing from the list was deleted, never published.
 */
export async function hasPullRequestReviewPublished(
  octokit: Octokit,
  input: DeletePendingPullRequestReviewInput,
): Promise<Result<boolean, GitHubApiError>> {
  const context = "check pull request review state";
  const listed = await readReviewList(octokit, input, context);
  if (!listed.ok) {
    return listed;
  }

  const reviewId = Number(input.reviewId);
  const published = listed.value.some((entry) => {
    const parsed = reviewListEntrySchema.safeParse(entry);
    return (
      parsed.success &&
      parsed.data.id === reviewId &&
      parsed.data.state !== PENDING_STATE
    );
  });
  return { ok: true, value: published };
}

const REVIEW_COMMENT_COUNT_QUERY = `
query PullRequestReviewCommentCount($id: ID!) {
  node(id: $id) {
    ... on PullRequestReview {
      comments {
        totalCount
      }
    }
  }
}`;

const commentCountResponseSchema = z.object({
  node: z.object({ comments: z.object({ totalCount: z.number() }) }).nullable(),
});

/**
 * How many comments a pending review carries. A viewer reads their own
 * pending review through GraphQL; zero is the shape of a review a crashed
 * request left behind, anything else is work the viewer has not sent.
 */
export async function countPendingReviewComments(
  octokit: Octokit,
  reviewNodeId: string,
): Promise<Result<number, GitHubApiError>> {
  const context = "count pending review comments";
  let response: unknown;
  try {
    response = await octokit.graphql(REVIEW_COMMENT_COUNT_QUERY, {
      id: reviewNodeId,
    });
  } catch (error) {
    return { ok: false, error: mapGraphqlError(error, context) };
  }

  const parsed = commentCountResponseSchema.safeParse(response);
  if (!parsed.success || parsed.data.node === null) {
    return { ok: false, error: unexpectedResponseError(context) };
  }
  return { ok: true, value: parsed.data.node.comments.totalCount };
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
    if (
      error instanceof RequestError &&
      error.status === HttpStatuses.NOT_FOUND
    ) {
      return { ok: true, value: undefined };
    }
    return {
      ok: false,
      error: mapRequestError(error, "delete pending pull request review"),
    };
  }
}
