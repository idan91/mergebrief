// Pin comments to the commit the anchor was read against; GitHub authorizes the write.
// REST maps ranges directly and returns the wrapping review id used for own-comment joins.
// Classify stale-anchor 422s internally so callers reload instead of retrying unchanged.
import type { Octokit } from "octokit";
import { RequestError } from "octokit";
import {
  mapRequestError,
  unexpectedResponseError,
  type GitHubApiError,
} from "../errors";
import { ReviewSubjectTypes, type ReviewCommentSide } from "./review";
import type { Result } from "../types";
import type { Mutable } from "types";

export interface CreateInlineReviewCommentBase {
  readonly owner: string;
  readonly repo: string;
  readonly prNumber: number;
  /** The head the anchor was read against, pins the comment to that diff. */
  readonly commitId: string;
  readonly path: string;
  readonly body: string;
}

export interface CreateLineInlineReviewCommentInput extends CreateInlineReviewCommentBase {
  /** The anchor line (the END line for a multi-line comment). */
  readonly line: number;
  readonly side: ReviewCommentSide;
  /** First line of a multi-line comment; omit for single-line. */
  readonly startLine?: number;
  readonly startSide?: ReviewCommentSide;
}

export interface CreateFileInlineReviewCommentInput extends CreateInlineReviewCommentBase {
  readonly subjectType: typeof ReviewSubjectTypes.FILE;
}

export type CreateInlineReviewCommentInput =
  | CreateLineInlineReviewCommentInput
  | CreateFileInlineReviewCommentInput;

export interface InlineReviewCommentResult {
  /** REST `databaseId` of the created comment. */
  readonly commentId: bigint;
  /**
   * The id of the review GitHub wraps this standalone comment in, the
   * own-comment reconciliation join key. Absent when GitHub returns no wrapping
   * review id or an unsafe one; the comment still posted, it just cannot be
   * joined by review id until a later fetch reconciles it.
   */
  readonly reviewId?: bigint;
}

/** A `staleAnchor` GitHub error: the pinned commit's diff no longer holds the anchor. */
export interface InlineReviewCommentError extends GitHubApiError {
  /** True when GitHub returned 422, the anchor/commit is no longer valid. */
  readonly staleAnchor?: boolean;
}

const CONTEXT = "create inline review comment";

type CreateReviewCommentParams = NonNullable<
  Parameters<Octokit["rest"]["pulls"]["createReviewComment"]>[0]
>;

function isFileInlineComment(
  input: CreateInlineReviewCommentInput,
): input is CreateFileInlineReviewCommentInput {
  return (
    "subjectType" in input && input.subjectType === ReviewSubjectTypes.FILE
  );
}

function shapeInlineCommentParams(
  input: CreateInlineReviewCommentInput,
): CreateReviewCommentParams {
  const params: CreateReviewCommentParams = {
    owner: input.owner,
    repo: input.repo,
    pull_number: input.prNumber,
    commit_id: input.commitId,
    path: input.path,
    body: input.body,
  };

  if (isFileInlineComment(input)) {
    params.subject_type = ReviewSubjectTypes.FILE;
    return params;
  }

  params.line = input.line;
  params.side = input.side;
  if (input.startLine !== undefined) params.start_line = input.startLine;
  if (input.startSide !== undefined) params.start_side = input.startSide;
  return params;
}

/**
 * Post one inline review comment pinned to `commitId`. Returns the created
 * comment id and (when GitHub assigns one) the wrapping review id. Failures are
 * sanitized `InlineReviewCommentError`s; a 422 additionally sets `staleAnchor`.
 */
export async function createInlineReviewComment(
  octokit: Octokit,
  input: CreateInlineReviewCommentInput,
): Promise<Result<InlineReviewCommentResult, InlineReviewCommentError>> {
  const params = shapeInlineCommentParams(input);

  try {
    const response = await octokit.rest.pulls.createReviewComment(params);
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
    const value: Mutable<InlineReviewCommentResult> = {
      commentId: BigInt(response.data.id),
    };

    if (reviewId !== undefined) value.reviewId = reviewId;

    return { ok: true, value };
  } catch (error) {
    const sanitized = mapRequestError(error, CONTEXT);
    if (error instanceof RequestError && error.status === 422) {
      return { ok: false, error: { ...sanitized, staleAnchor: true } };
    }
    return { ok: false, error: sanitized };
  }
}
