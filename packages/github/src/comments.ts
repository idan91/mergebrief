// Entry-comment operations (BRIEF-2 stage 2, ADR 0016 #3: the single branded
// "brief ready" comment is maintained delete-and-repost). The PR-conversation
// comment lives on the issues timeline, so it uses the issues-comments
// endpoints — but for a pull request those are authorized by `Pull requests:
// write` (ADR 0016 / docs/self-host/github-app.md), so the App needs NO
// `Issues` scope. Every failure funnels through `mapRequestError` (no tokens/
// headers/bodies leak).
import type { Octokit } from "octokit";
import { RequestError } from "octokit";
import { mapRequestError, unexpectedResponseError, type GitHubApiError } from "./errors";
import type { Result } from "./types";

export interface PostEntryCommentInput {
  readonly owner: string;
  readonly repo: string;
  readonly prNumber: number;
  readonly body: string;
}

export interface DeleteCommentInput {
  readonly owner: string;
  readonly repo: string;
  /** The comment id returned by a prior `postEntryComment`. */
  readonly commentId: bigint;
}

/**
 * Post the Entry comment on a PR's conversation timeline and return its id
 * (branded downstream by persistence, a plain `bigint` here). Uses
 * `issues.createComment` — authorized by `Pull requests: write` for a PR.
 */
export async function postEntryComment(
  octokit: Octokit,
  input: PostEntryCommentInput,
): Promise<Result<{ readonly commentId: bigint }, GitHubApiError>> {
  try {
    const response = await octokit.rest.issues.createComment({
      owner: input.owner,
      repo: input.repo,
      issue_number: input.prNumber,
      body: input.body,
    });
    // Same precision guard as `ids.ts`: JSON.parse rounds ints past 2^53 before
    // we see them, and a lossy comment id would silently break the later
    // delete-and-repost cycle (deleteComment maps the wrong-id 404 to ok).
    if (!Number.isSafeInteger(response.data.id)) {
      return { ok: false, error: unexpectedResponseError("post entry comment") };
    }
    return { ok: true, value: { commentId: BigInt(response.data.id) } };
  } catch (error) {
    return { ok: false, error: mapRequestError(error, "post entry comment") };
  }
}

/**
 * Delete a previously posted Entry comment. Idempotent by design: a 404 means
 * the comment is already gone (deleted, or the PR/repo removed), which for a
 * delete-and-repost flow is a success, not a failure — so it maps to `ok`.
 */
export async function deleteComment(
  octokit: Octokit,
  input: DeleteCommentInput,
): Promise<Result<void, GitHubApiError>> {
  try {
    await octokit.rest.issues.deleteComment({
      owner: input.owner,
      repo: input.repo,
      comment_id: Number(input.commentId),
    });
    return { ok: true, value: undefined };
  } catch (error) {
    if (error instanceof RequestError && error.status === 404) {
      return { ok: true, value: undefined };
    }
    return { ok: false, error: mapRequestError(error, "delete comment") };
  }
}
