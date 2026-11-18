// Publish a PENDING review through GraphQL: the verdict and the review body
// ride here, after every thread has attached. Failures funnel through
// `mapGraphqlError`.
import type { Octokit } from "octokit";
import { z } from "zod/v4";
import {
  mapGraphqlError,
  unexpectedResponseError,
  type GitHubApiError,
} from "../errors";
import type { Result, ValueOf } from "types/utils";

/** GitHub wire values for the review `event`, not our kebab-case vocabulary. */
export const ReviewEvents = {
  APPROVE: "APPROVE",
  REQUEST_CHANGES: "REQUEST_CHANGES",
  COMMENT: "COMMENT",
} as const;
export type ReviewEvent = ValueOf<typeof ReviewEvents>;

export interface SubmitPullRequestReviewInput {
  /** The pending review's GraphQL node id. */
  readonly reviewNodeId: string;
  readonly event: ReviewEvent;
  readonly body?: string;
}

const CONTEXT = "submit pull request review";

const SUBMIT_REVIEW_MUTATION = `
mutation SubmitPullRequestReview($input: SubmitPullRequestReviewInput!) {
  submitPullRequestReview(input: $input) {
    pullRequestReview {
      id
    }
  }
}`;

const mutationResponseSchema = z.object({
  submitPullRequestReview: z
    .object({
      pullRequestReview: z.object({ id: z.string() }).nullable(),
    })
    .nullable(),
});

interface SubmitMutationInput {
  pullRequestReviewId: string;
  event: ReviewEvent;
  body?: string;
}

/**
 * Submit a pending review with its verdict, authored by whoever the
 * octokit's token identifies. The body is optional on the wire; GitHub
 * itself refuses a bodiless REQUEST_CHANGES.
 */
export async function submitPullRequestReview(
  octokit: Octokit,
  input: SubmitPullRequestReviewInput,
): Promise<Result<void, GitHubApiError>> {
  const variables: SubmitMutationInput = {
    pullRequestReviewId: input.reviewNodeId,
    event: input.event,
  };
  if (input.body !== undefined) {
    variables.body = input.body;
  }

  let response: unknown;
  try {
    response = await octokit.graphql(SUBMIT_REVIEW_MUTATION, {
      input: variables,
    });
  } catch (error) {
    return { ok: false, error: mapGraphqlError(error, CONTEXT) };
  }

  // A 2xx with a null payload still means the review left pending state, and
  // reporting failure would invite a retry that submits twice.
  const parsed = mutationResponseSchema.safeParse(response);
  if (!parsed.success) {
    return { ok: false, error: unexpectedResponseError(CONTEXT) };
  }
  return { ok: true, value: undefined };
}
