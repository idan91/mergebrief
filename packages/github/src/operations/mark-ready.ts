// Mark-ready mutation: flip a draft PR to ready-for-review with the VIEWER's
// own token — GitHub itself enforces that only the author or a maintainer may
// do this, so no local role model is involved. The mutation takes a node ID,
// never a number, so the PR's node id is resolved first and never leaves this
// module. Failures funnel through `mapGraphqlError`.
//
// Convergence: a PR ALREADY out of draft is not a failure. Both the read-time
// check and the race backstop (GitHub's "Pull request is not a draft" mutation
// error) resolve to `ok: true` with `alreadyReady: true`.
import type { Octokit } from "octokit";
import { z } from "zod";
import {
  GitHubApiErrorCodes,
  mapGraphqlError,
  unexpectedResponseError,
  type GitHubApiError,
} from "../errors";
import type { Result } from "../types";

export interface MarkPullRequestReadyInput {
  readonly owner: string;
  readonly repo: string;
  readonly prNumber: number;
}

export interface MarkReadyResult {
  /**
   * True when the PR was ALREADY out of draft — read-time or racing the
   * mutation. A converged state, not a failure; surfaced only so a caller can
   * tell a no-op apart from a fresh flip.
   */
  readonly alreadyReady: boolean;
}

const CONTEXT = "mark pull request ready for review";

// `repository` and `pullRequest` are nullable in GitHub's schema — a missing
// or inaccessible resource can arrive as a null FIELD in a 2xx response, not
// only as a GraphQL error.
const nodeIdResponseSchema = z.object({
  repository: z
    .object({
      pullRequest: z
        .object({ id: z.string(), isDraft: z.boolean() })
        .nullable(),
    })
    .nullable(),
});

const mutationResponseSchema = z.object({
  markPullRequestReadyForReview: z
    .object({
      pullRequest: z.object({ isDraft: z.boolean() }).nullable(),
    })
    .nullable(),
});

const NODE_ID_QUERY = `
query PullRequestNodeId($owner: String!, $repo: String!, $prNumber: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $prNumber) {
      id
      isDraft
    }
  }
}`;

const MARK_READY_MUTATION = `
mutation MarkPullRequestReady($pullRequestId: ID!) {
  markPullRequestReadyForReview(input: { pullRequestId: $pullRequestId }) {
    pullRequest {
      isDraft
    }
  }
}`;

function resourceNotFoundError(): GitHubApiError {
  return {
    code: GitHubApiErrorCodes.NOT_FOUND,
    message: `failed to ${CONTEXT}: pull request not found`,
  };
}

// GitHub rejects the mutation on a non-draft PR with a GraphQL error whose
// discriminator lives ONLY in the human-readable message, so classification is
// best-effort. The message is regex-tested and NEVER copied into the returned
// error, so no upstream text can leak.
const notADraftShapeSchema = z.object({
  errors: z.array(z.object({ message: z.string().optional() })).optional(),
});
const NOT_A_DRAFT = /not a draft/i;

function isAlreadyReadyError(error: unknown): boolean {
  const parsed = notADraftShapeSchema.safeParse(error);
  if (!parsed.success) {
    return false;
  }
  return (parsed.data.errors ?? []).some(
    (entry) => entry.message !== undefined && NOT_A_DRAFT.test(entry.message),
  );
}

/**
 * Mark a draft PR ready for review, authored by whoever the octokit's token
 * identifies. An already-non-draft PR skips the mutation entirely; one that
 * races a concurrent ready transition likewise converges.
 */
export async function markPullRequestReadyForReview(
  octokit: Octokit,
  input: MarkPullRequestReadyInput,
): Promise<Result<MarkReadyResult, GitHubApiError>> {
  const variables = {
    owner: input.owner,
    repo: input.repo,
    prNumber: input.prNumber,
  };

  let resolved: unknown;
  try {
    resolved = await octokit.graphql(NODE_ID_QUERY, variables);
  } catch (error) {
    return { ok: false, error: mapGraphqlError(error, CONTEXT) };
  }

  const parsed = nodeIdResponseSchema.safeParse(resolved);
  if (!parsed.success) {
    return { ok: false, error: unexpectedResponseError(CONTEXT) };
  }
  const pullRequest = parsed.data.repository?.pullRequest;
  if (pullRequest === null || pullRequest === undefined) {
    return { ok: false, error: resourceNotFoundError() };
  }

  // Already out of draft at read time — converged, no mutation needed.
  if (!pullRequest.isDraft) {
    return { ok: true, value: { alreadyReady: true } };
  }

  try {
    const mutated = await octokit.graphql(MARK_READY_MUTATION, {
      pullRequestId: pullRequest.id,
    });
    const parsedMutation = mutationResponseSchema.safeParse(mutated);
    if (!parsedMutation.success) {
      return { ok: false, error: unexpectedResponseError(CONTEXT) };
    }
    return { ok: true, value: { alreadyReady: false } };
  } catch (error) {
    // Raced a concurrent ready transition → GitHub says "not a draft".
    // Converged, not a failure.
    if (isAlreadyReadyError(error)) {
      return { ok: true, value: { alreadyReady: true } };
    }
    return { ok: false, error: mapGraphqlError(error, CONTEXT) };
  }
}
