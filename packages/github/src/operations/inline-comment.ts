// Standalone inline review-comment write (BRIEF-43 PR 4): post ONE review
// comment on a PR's diff, anchored to file+line/range and PINNED to the commit
// the anchor was read against (`commit_id`), authored by whoever the octokit's
// token identifies — the VIEWER's user-to-server token (ADR 0016 #4 / ADR
// 0031). GitHub itself authorizes the write (anyone with repo access may
// comment), so the own-draft gate is a UX affordance placement, not a security
// boundary — this primitive is authorization-agnostic.
//
// REST, not GraphQL: this mirrors the package's other comment writes
// (`comments.ts`, `review.ts`, the conversation reply) — the anchor maps 1:1
// to the REST `path/line/side/start_line/start_side` shape, and the response
// hands us the REST `databaseId` (the comment id) AND the `pull_request_review_id`
// GitHub assigns to the wrapping review DIRECTLY, no node-id round-trip. That
// review id is the own-comment reconciliation join key (BRIEF-25): recording
// it lets the fetched thread render with the "yours" tag. GraphQL's
// `addPullRequestReviewThread` returns node ids we would then have to resolve
// back to databaseIds for that same join, so REST is the strictly simpler seam.
//
// Failures funnel through `mapRequestError` (no token/header/body bytes leak).
// A 422 means the anchor no longer sits on the pinned commit's diff (the head
// advanced under the composer): flagged `staleAnchor` so the route can tell the
// FE to reload rather than surfacing it as a retry-looking upstream error —
// the SAME best-effort posture review.ts takes on its unknown-commit 422.
import type { Octokit } from "octokit";
import { RequestError } from "octokit";
import { mapRequestError, unexpectedResponseError, type GitHubApiError } from "../errors";
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
   * The id of the review GitHub wraps this standalone comment in, when it
   * assigns one (`pull_request_review_id`) — the own-comment reconciliation
   * join key (BRIEF-25). Absent when GitHub returns no wrapping review id or
   * an unsafe one; the comment still posted, it just cannot be tagged "yours"
   * by the review-id join until the next fetch reconciles it another way.
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
    // Same precision guard as comments.ts/review.ts: JSON.parse rounds ints
    // past 2^53, and a lossy comment id would break every downstream join.
    if (!Number.isSafeInteger(response.data.id)) {
      return { ok: false, error: unexpectedResponseError(CONTEXT) };
    }
    // The wrapping review id is best-effort: a null or lossy value drops to
    // `undefined` (the comment posted regardless — never fail a good write on
    // an unusable join key).
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
