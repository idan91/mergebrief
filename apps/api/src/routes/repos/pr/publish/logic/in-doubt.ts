// Whether GitHub holds what an earlier attempt sent for a draft: the
// viewer's own published comment on the same anchor with the same words, or
// a review whose body folded it.
import {
  PullRequestReviewStates,
  ReviewSubjectTypes,
  type AuthoredReview,
  type InlineReviewCommentResult,
  type ListedReviewComment,
} from "github";
import type { Mutable } from "types/utils";
import { IN_DOUBT_LOOKUP_MARGIN_MS, MS_PER_SECOND } from "../consts";
import type {
  GitHubAnchor,
  LineGitHubAnchor,
  PartitionedReviewComments,
  PostedCommentMatch,
  PublishableDraft,
  PublishComment,
} from "../types";
import { isFileGitHubAnchor, shapePublishComment } from "./anchor";
import { shapeFoldedCommentBlock } from "./fold";

const LINE_ENDINGS = /\r\n/g;

function normalizeLineEndings(body: string): string {
  return body.replace(LINE_ENDINGS, "\n");
}

/** A push moves `line` to the new head; `original*` keeps where it was posted. */
function isSameLines(
  listed: ListedReviewComment,
  anchor: LineGitHubAnchor,
): boolean {
  const onCurrentHead =
    listed.line === anchor.line && listed.startLine === anchor.startLine;
  const asPosted =
    listed.originalLine === anchor.line &&
    listed.originalStartLine === anchor.startLine;
  return onCurrentHead || asPosted;
}

function isSameAnchor(
  listed: ListedReviewComment,
  anchor: GitHubAnchor,
): boolean {
  if (listed.path !== anchor.path) {
    return false;
  }
  if (isFileGitHubAnchor(anchor)) {
    return listed.subjectType === ReviewSubjectTypes.FILE;
  }
  const sameSides =
    listed.subjectType === ReviewSubjectTypes.LINE &&
    listed.side === anchor.side &&
    listed.startSide === anchor.startSide;
  const sameLineAnchor = sameSides && isSameLines(listed, anchor);
  return sameLineAnchor;
}

function isPostedComment(
  listed: ListedReviewComment,
  comment: PublishComment,
  viewerId: bigint,
): boolean {
  const sameBody =
    normalizeLineEndings(listed.body) === normalizeLineEndings(comment.body);
  const postedByViewer = listed.authorId === viewerId && sameBody;
  const posted = postedByViewer && isSameAnchor(listed, comment.anchor);
  return posted;
}

function shapePostedResult(
  listed: ListedReviewComment,
): InlineReviewCommentResult {
  const posted: Mutable<InlineReviewCommentResult> = {
    commentId: listed.commentId,
  };
  if (listed.reviewId !== undefined) {
    posted.reviewId = listed.reviewId;
  }
  return posted;
}

/** The first of `drafts`, in order, that the listing holds a comment for. */
export function matchPostedComment<Draft extends PublishableDraft>(
  listed: readonly ListedReviewComment[],
  drafts: readonly Draft[],
  viewerId: bigint,
): PostedCommentMatch<Draft> | undefined {
  for (const draft of drafts) {
    const comment = shapePublishComment(draft);
    const found = listed.find((row) => isPostedComment(row, comment, viewerId));
    if (found !== undefined) {
      return { draft, posted: shapePostedResult(found) };
    }
  }
  return undefined;
}

/** Where a lookup for writes made since a claim starts. */
export function deriveLookupSince(claimedAt: Date): Date {
  const wholeSeconds = Math.floor(claimedAt.getTime() / MS_PER_SECOND);
  return new Date(wholeSeconds * MS_PER_SECOND - IN_DOUBT_LOOKUP_MARGIN_MS);
}

/**
 * The listed comments split by whether one of the viewer's pending reviews
 * holds them: those are on GitHub unsent, never published.
 */
export function partitionPendingReviewComments(
  listed: readonly ListedReviewComment[],
  viewerReviews: readonly AuthoredReview[],
): PartitionedReviewComments {
  const pending = viewerReviews.filter(
    (review) => review.state === PullRequestReviewStates.PENDING,
  );
  const pendingIds = new Set(pending.map((review) => review.reviewId));

  const partition: PartitionedReviewComments = { published: [], pending: [] };
  for (const row of listed) {
    const inPendingReview =
      row.reviewId !== undefined && pendingIds.has(row.reviewId);
    if (inPendingReview) {
      partition.pending.push(row);
    } else {
      partition.published.push(row);
    }
  }
  return partition;
}

function isFoldingReview(
  review: AuthoredReview,
  block: string,
  since: Date,
): boolean {
  const { submittedAt } = review;
  if (
    review.state === PullRequestReviewStates.PENDING ||
    submittedAt === undefined
  ) {
    return false;
  }
  const submittedSince = submittedAt.getTime() >= since.getTime();
  const body = normalizeLineEndings(review.body);
  const folding = submittedSince && body.includes(block);
  return folding;
}

/**
 * Whether a review submitted at or after `since` carries `comment` as the
 * fold writes it: the bolded anchor line, then the body.
 */
export function hasReviewFoldedComment(
  viewerReviews: readonly AuthoredReview[],
  comment: PublishComment,
  since: Date,
): boolean {
  const block = normalizeLineEndings(shapeFoldedCommentBlock(comment));
  return viewerReviews.some((review) => isFoldingReview(review, block, since));
}
