// A PR's review comments touched since a given time, read with the viewer's
// token: the evidence a caller checks before posting a comment it may
// already have posted.
import type { Octokit } from "octokit";
import { z } from "zod/v4";
import type { Mutable, Result } from "types/utils";
import { mapRequestError, type GitHubApiError } from "../errors";
import {
  ReviewCommentSides,
  ReviewSubjectTypes,
  type ReviewCommentSide,
  type ReviewSubjectType,
} from "./review-thread";
import type { PullRequestReviewRef } from "./review-pending";

export interface ListReviewCommentsSinceInput extends PullRequestReviewRef {
  readonly since: Date;
}

/**
 * One review comment as a caller matches it against what it posted. `line`
 * and `startLine` are its place on the current head, absent once outdated;
 * the `original*` pair is where it was posted.
 */
export interface ListedReviewComment {
  readonly commentId: bigint;
  readonly reviewId?: bigint;
  readonly authorId?: bigint;
  readonly path: string;
  readonly body: string;
  readonly subjectType: ReviewSubjectType;
  readonly line?: number;
  readonly side?: ReviewCommentSide;
  readonly startLine?: number;
  readonly startSide?: ReviewCommentSide;
  readonly originalLine?: number;
  readonly originalStartLine?: number;
}

/** `complete` is false when the page bound cut the list short. */
export interface ReviewCommentListing {
  readonly comments: readonly ListedReviewComment[];
  readonly complete: boolean;
}

const CONTEXT = "list review comments";
const COMMENTS_PER_PAGE = 100;
const MAX_PAGES = 10;
const NEXT_PAGE_LINK = 'rel="next"';

const sideSchema = z.enum(ReviewCommentSides).nullish();
const lineSchema = z.number().int().positive().nullish();
const idSchema = z.number().refine(Number.isSafeInteger);

const wireCommentSchema = z.object({
  id: idSchema,
  pull_request_review_id: idSchema.nullish(),
  user: z.object({ id: idSchema }).nullish(),
  path: z.string(),
  body: z.string(),
  subject_type: z.enum(ReviewSubjectTypes).nullish(),
  line: lineSchema,
  original_line: lineSchema,
  side: sideSchema,
  start_line: lineSchema,
  original_start_line: lineSchema,
  start_side: sideSchema,
});

type WireComment = z.infer<typeof wireCommentSchema>;

function shapeListedComment(wire: WireComment): ListedReviewComment {
  const listed: Mutable<ListedReviewComment> = {
    commentId: BigInt(wire.id),
    path: wire.path,
    body: wire.body,
    subjectType: wire.subject_type ?? ReviewSubjectTypes.LINE,
  };
  if (typeof wire.pull_request_review_id === "number") {
    listed.reviewId = BigInt(wire.pull_request_review_id);
  }
  if (typeof wire.user?.id === "number") {
    listed.authorId = BigInt(wire.user.id);
  }
  if (typeof wire.line === "number") {
    listed.line = wire.line;
  }
  if (typeof wire.start_line === "number") {
    listed.startLine = wire.start_line;
  }
  if (typeof wire.original_line === "number") {
    listed.originalLine = wire.original_line;
  }
  if (typeof wire.original_start_line === "number") {
    listed.originalStartLine = wire.original_start_line;
  }
  if (typeof wire.side === "string") {
    listed.side = wire.side;
  }
  if (typeof wire.start_side === "string") {
    listed.startSide = wire.start_side;
  }
  return listed;
}

function readComments(data: readonly unknown[]): ListedReviewComment[] {
  const comments: ListedReviewComment[] = [];
  for (const entry of data) {
    const parsed = wireCommentSchema.safeParse(entry);
    if (parsed.success) {
      comments.push(shapeListedComment(parsed.data));
    }
  }
  return comments;
}

/**
 * The PR's review comments updated at or after `since`, oldest first, at
 * most `MAX_PAGES` pages. An entry that will not parse is skipped: it cannot
 * be the comment a caller is looking for.
 */
export async function listReviewCommentsSince(
  octokit: Octokit,
  input: ListReviewCommentsSinceInput,
): Promise<Result<ReviewCommentListing, GitHubApiError>> {
  const pages = octokit.paginate.iterator(
    octokit.rest.pulls.listReviewComments,
    {
      owner: input.owner,
      repo: input.repo,
      pull_number: input.prNumber,
      since: input.since.toISOString(),
      per_page: COMMENTS_PER_PAGE,
    },
  );

  const comments: ListedReviewComment[] = [];
  let read = 0;
  try {
    for await (const page of pages) {
      comments.push(...readComments(page.data));
      read += 1;
      const hasNext = page.headers.link?.includes(NEXT_PAGE_LINK) === true;
      const cutShort = read >= MAX_PAGES && hasNext;
      if (cutShort) {
        return { ok: true, value: { comments, complete: false } };
      }
    }
  } catch (error) {
    return { ok: false, error: mapRequestError(error, CONTEXT) };
  }
  return { ok: true, value: { comments, complete: true } };
}
