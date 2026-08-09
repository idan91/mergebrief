// Standalone inline review-comment write: ONE review comment on a PR's diff,
// anchored to file+line/range and PINNED to the commit the anchor was read
// against. GitHub itself authorizes the write (anyone with repo access may
// comment), so this primitive is authorization-agnostic.
//
// REST, not GraphQL: the anchor maps 1:1 to the REST
// `path/line/side/start_line/start_side` shape, and the response hands back the
// comment id AND the `pull_request_review_id` of the wrapping review directly,
// with no node-id round-trip. That review id is the own-comment reconciliation
// join key.
//
// Failures funnel through `mapRequestError`. A 422 means the anchor no longer
// sits on the pinned commit's diff (the head advanced under the composer):
// flagged `staleAnchor` so the caller can reload rather than surface a
// retry-looking upstream error.
import type { Octokit } from "octokit";
import { RequestError } from "octokit";
import {
  mapRequestError,
  unexpectedResponseError,
  type GitHubApiError,
} from "../errors";
import type { ReviewCommentSide } from "./review";
import type { Result } from "../types";

export interface CreateInlineReviewCommentInput {
  readonly owner: string;
  readonly repo: string;
  readonly prNumber: number;
  /** The head the anchor was read against — pins the comment to that diff. */
  readonly commitId: string;
  readonly path: string;
  /** The anchor line (the END line for a multi-line comment). */
  readonly line: number;
  readonly side: ReviewCommentSide;
  /** First line of a multi-line comment; omit for single-line. */
  readonly startLine?: number;
  readonly startSide?: ReviewCommentSide;
  readonly body: string;
}

export interface InlineReviewCommentResult {
  /** REST `databaseId` of the created comment. */
  readonly commentId: bigint;
  /**
   * The id of the review GitHub wraps this standalone comment in — the
   * own-comment reconciliation join key. Absent when GitHub returns no wrapping
   * review id or an unsafe one; the comment still posted, it just cannot be
   * joined by review id until a later fetch reconciles it.
   */
  readonly reviewId?: bigint;
}

/** A `staleAnchor` GitHub error: the pinned commit's diff no longer holds the anchor. */
export interface InlineReviewCommentError extends GitHubApiError {
  /** True when GitHub returned 422 — the anchor/commit is no longer valid. */
  readonly staleAnchor?: boolean;
}

const CONTEXT = "create inline review comment";

/**
 * Post one inline review comment pinned to `commitId`. Returns the created
 * comment id and (when GitHub assigns one) the wrapping review id. Failures are
 * sanitized `InlineReviewCommentError`s; a 422 additionally sets `staleAnchor`.
 */
export async function createInlineReviewComment(
  octokit: Octokit,
  input: CreateInlineReviewCommentInput,
): Promise<Result<InlineReviewCommentResult, InlineReviewCommentError>> {
  try {
    const response = await octokit.rest.pulls.createReviewComment({
      owner: input.owner,
      repo: input.repo,
      pull_number: input.prNumber,
      commit_id: input.commitId,
      path: input.path,
      line: input.line,
      side: input.side,
      ...(input.startLine === undefined ? {} : { start_line: input.startLine }),
      ...(input.startSide === undefined ? {} : { start_side: input.startSide }),
      body: input.body,
    });
    // JSON.parse rounds ints past 2^53; a lossy comment id would break every
    // downstream join.
    if (!Number.isSafeInteger(response.data.id)) {
      return { ok: false, error: unexpectedResponseError(CONTEXT) };
    }
    // Best-effort: a null or lossy value drops to `undefined` rather than
    // failing a write that already succeeded.
    const rawReviewId = response.data.pull_request_review_id;
    const reviewId =
      typeof rawReviewId === "number" && Number.isSafeInteger(rawReviewId)
        ? BigInt(rawReviewId)
        : undefined;
    return {
      ok: true,
      value: {
        commentId: BigInt(response.data.id),
        ...(reviewId === undefined ? {} : { reviewId }),
      },
    };
  } catch (error) {
    const sanitized = mapRequestError(error, CONTEXT);
    if (error instanceof RequestError && error.status === 422) {
      return { ok: false, error: { ...sanitized, staleAnchor: true } };
    }
    return { ok: false, error: sanitized };
  }
}
