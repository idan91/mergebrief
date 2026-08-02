// Mark-ready mutation (BRIEF-43): flip a draft PR to ready-for-review with the
// VIEWER's own token — GitHub itself enforces that only the author or a
// maintainer may do this, so no MergeBrief role model is involved (ADR 0031).
// GraphQL, like the conversation primitive: resolve the PR's node id first
// (the mutation takes a node ID, never a number), then run the mutation. The
// node id never leaves this module. Failures funnel through `mapGraphqlError`
// (no upstream text, no token).
//
// Convergence: a PR that is ALREADY out of draft is not a failure — the caller
// wants the PR ready, and it is. Both the read-time check (`isDraft: false`)
// and the race backstop (GitHub's "Pull request is not a draft" mutation
// error) resolve to `ok: true` with `alreadyReady: true`; the route treats
// that as converged (200, state refreshed), never an error.
import type { Octokit } from "octokit";
import { z } from "zod";
import {
  GitHubApiErrorCode,
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
   * True when GitHub reported the PR was ALREADY out of draft — either the
   * read-time `isDraft` was already false, or the mutation raced a concurrent
   * ready transition and GitHub rejected it as "not a draft". Both are
   * converged states, not failures; surfaced so the route/caller can tell a
   * no-op apart from a fresh flip (audit/telemetry), while treating both as
   * success.
   */
  readonly alreadyReady: boolean;
}

const CONTEXT = "mark pull request ready for review";

// `repository` and `pullRequest` are nullable in GitHub's schema — a missing
// or inaccessible resource can arrive as a null FIELD in a 2xx response, not
// only as a GraphQL error (same contract the conversation primitive relies on).
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
    code: GitHubApiErrorCode.NOT_FOUND,
    message: `failed to ${CONTEXT}: pull request not found`,
  };
}

// GitHub rejects `markPullRequestReadyForReview` on a non-draft PR with a
// GraphQL error whose message reads "Pull request is not a draft". The
// discriminator lives ONLY in the human-readable message (no stable machine
// code), so classification is best-effort over the message text — the SAME
// best-effort posture as review.ts's 422 classifier. The message is read to
// test a regex and is NEVER copied into the returned error (mapGraphqlError
// still owns sanitization), so no upstream text or token can leak.
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
 * identifies (the viewer's user-to-server token — ADR 0016 #4 / ADR 0031).
 * Resolves the PR node id first; if the PR is already out of draft the
 * mutation is skipped entirely (converged). A mutation that races a concurrent
 * ready transition ("not a draft") likewise converges. All other failures are
 * sanitized `GitHubApiError`s.
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
