// Entry-comment operations: the single comment is maintained by
// delete-and-repost. It lives on the issues timeline, so it uses the
// issues-comments endpoints; for a pull request those are authorized by
// `Pull requests: write`, so the App needs NO `Issues` scope. Every failure
// funnels through `mapRequestError`.
import type { Octokit } from "octokit";
import { RequestError } from "octokit";
import {
  mapRequestError,
  unexpectedResponseError,
  type GitHubApiError,
} from "../errors";
import type { Result } from "types/utils";
import { HttpStatuses } from "types/http";

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

export interface FetchCommentInput {
  readonly owner: string;
  readonly repo: string;
  /** The comment id returned by a prior `postEntryComment`. */
  readonly commentId: bigint;
}

/**
 * Read a previously posted Entry comment's current body. A 404 is an expected
 * state for the delete-and-repost flow, so it maps to `ok` with `undefined`.
 */
export async function fetchComment(
  octokit: Octokit,
  input: FetchCommentInput,
): Promise<Result<{ readonly body: string } | undefined, GitHubApiError>> {
  try {
    const response = await octokit.rest.issues.getComment({
      owner: input.owner,
      repo: input.repo,
      comment_id: Number(input.commentId),
    });
    return { ok: true, value: { body: response.data.body ?? "" } };
  } catch (error) {
    if (
      error instanceof RequestError &&
      error.status === HttpStatuses.NOT_FOUND
    ) {
      return { ok: true, value: undefined };
    }
    return { ok: false, error: mapRequestError(error, "fetch comment") };
  }
}

/**
 * Post the Entry comment on a PR's conversation timeline and return its id
 * (branded downstream by persistence, a plain `bigint` here).
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
    // JSON.parse rounds ints past 2^53 before we see them; a lossy comment id
    // would silently break the delete-and-repost cycle.
    if (!Number.isSafeInteger(response.data.id)) {
      return {
        ok: false,
        error: unexpectedResponseError("post entry comment"),
      };
    }
    return { ok: true, value: { commentId: BigInt(response.data.id) } };
  } catch (error) {
    return { ok: false, error: mapRequestError(error, "post entry comment") };
  }
}

/**
 * Delete a previously posted Entry comment. Idempotent: a 404 means the comment
 * is already gone, which is a success for a delete-and-repost flow.
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
    if (
      error instanceof RequestError &&
      error.status === HttpStatuses.NOT_FOUND
    ) {
      return { ok: true, value: undefined };
    }
    return { ok: false, error: mapRequestError(error, "delete comment") };
  }
}
