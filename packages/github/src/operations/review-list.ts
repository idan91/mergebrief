import type { Octokit } from "octokit";
import { z } from "zod/v4";
import {
  ReviewVerdictStates,
  type ReviewVerdictState,
} from "types/conversation";
import type { Mutable, Result } from "types/utils";
import { positiveBigIntSchema } from "../ids";
import {
  mapRequestError,
  unexpectedResponseError,
  type GitHubApiError,
} from "../errors";
import type { PullRequestRef } from "./pull-request/types";
import { PullRequestReviewStates } from "./review";

const REVIEWS_PER_PAGE = 100;

/** One submitted review, oldest first as GitHub lists them. */
export interface SubmittedReview {
  readonly reviewId: bigint;
  readonly state: ReviewVerdictState;
  readonly authorId?: bigint;
  /** The head the review was submitted against. */
  readonly commitId?: string;
}

const reviewEntrySchema = z.object({
  id: positiveBigIntSchema,
  state: z.string(),
  user: z.object({ id: positiveBigIntSchema }).nullish(),
  commit_id: z.string().nullish(),
});
const submittedStateSchema = z.enum(ReviewVerdictStates);

/** Every review on the PR as GitHub's raw entries, paginated to exhaustion. */
export async function readReviewList(
  octokit: Octokit,
  ref: PullRequestRef,
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

type ReviewEntry = z.infer<typeof reviewEntrySchema>;

function shapeSubmittedReview(
  entry: ReviewEntry,
  state: ReviewVerdictState,
): SubmittedReview {
  const review: Mutable<SubmittedReview> = {
    reviewId: entry.id,
    state,
  };
  if (entry.user?.id !== undefined) {
    review.authorId = entry.user.id;
  }
  if (typeof entry.commit_id === "string") {
    review.commitId = entry.commit_id;
  }
  return review;
}

/**
 * Every submitted review on the PR. A pending one is the token holder's own
 * draft and is left out; an entry that will not parse fails the answer.
 */
export async function listSubmittedReviews(
  octokit: Octokit,
  ref: PullRequestRef,
): Promise<Result<SubmittedReview[], GitHubApiError>> {
  const context = "list pull request reviews";
  const listed = await readReviewList(octokit, ref, context);
  if (!listed.ok) {
    return listed;
  }

  const reviews: SubmittedReview[] = [];
  for (const raw of listed.value) {
    const entry = reviewEntrySchema.safeParse(raw);
    if (!entry.success) {
      return { ok: false, error: unexpectedResponseError(context) };
    }
    if (entry.data.state === PullRequestReviewStates.PENDING) {
      continue;
    }
    const state = submittedStateSchema.safeParse(entry.data.state);
    if (!state.success) {
      return { ok: false, error: unexpectedResponseError(context) };
    }
    reviews.push(shapeSubmittedReview(entry.data, state.data));
  }
  return { ok: true, value: reviews };
}
