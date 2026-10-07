import type {
  AddReviewThreadInput,
  CreateReviewError,
  GitHubApiError,
  InlineReviewCommentError,
  InlineReviewCommentResult,
  PendingReview,
  ReviewCommentSide,
  ReviewSubjectTypes,
  ReviewThread,
  ReviewThreadFailure,
} from "github";
import type { Logger } from "logging";
import type { ReviewDraftCommentRow } from "persistence";
import type { ReviewOutcome } from "types/reviews";
import type { Result } from "types/utils";
import type {
  GitHubDeniedFailure,
  TokenUnreadableFailure,
} from "../../../../shared-errors/failures";
import type { ReviewerGitHubClient } from "../../../auth/reviewer-github-client";

/** Narrow slice: the per-request reviewer channel plus the request log. */
export interface PublishDeps {
  readonly github: ReviewerGitHubClient;
  readonly log: Logger;
}

/** The PR and the reviewed head every published comment is pinned to. */
export interface PublishTarget {
  readonly owner: string;
  readonly repo: string;
  readonly prNumber: number;
  readonly commitId: string;
}

export interface LineGitHubAnchor {
  readonly path: string;
  readonly line: number;
  readonly side: ReviewCommentSide;
  readonly startLine?: number;
  readonly startSide?: ReviewCommentSide;
}

export interface FileGitHubAnchor {
  readonly path: string;
  readonly subjectType: typeof ReviewSubjectTypes.FILE;
}

/** A stored draft anchor in GitHub's line and side vocabulary. */
export type GitHubAnchor = LineGitHubAnchor | FileGitHubAnchor;

/** One held draft as either transport sends it. */
export interface PublishComment {
  readonly anchor: GitHubAnchor;
  readonly body: string;
}

export type CommentPublishFailure =
  | TokenUnreadableFailure
  | GitHubDeniedFailure<InlineReviewCommentError>;

export type CommentPublishResult = Result<
  InlineReviewCommentResult,
  CommentPublishFailure
>;

/**
 * The viewer's own pending review on GitHub carries comments they have not
 * sent; the route never deletes that for them.
 */
export interface PendingReviewHeldFailure {
  readonly kind: "pending-review-held";
  readonly commentCount: number;
}

export type ReviewPublishFailure =
  | TokenUnreadableFailure
  | GitHubDeniedFailure<CreateReviewError>
  | PendingReviewHeldFailure;

export interface ReviewPublishInput {
  readonly target: PublishTarget;
  readonly outcome: ReviewOutcome;
  readonly body: string | undefined;
  readonly drafts: readonly ReviewDraftCommentRow[];
}

export interface PublishedReview {
  readonly reviewId: bigint;
  readonly commentsFolded: number;
  readonly commentsTotal: number;
}

export type ReviewPublishResult = Result<PublishedReview, ReviewPublishFailure>;

export type PendingReviewResult = Result<
  PendingReview,
  CreateReviewError | TokenUnreadableFailure | PendingReviewHeldFailure
>;

export type SubmitPendingResult = Result<
  void,
  GitHubApiError | TokenUnreadableFailure
>;

/** One thread mutation on the reviewer's token, refresh budget included. */
export type PostThread = (
  input: AddReviewThreadInput,
) => Promise<
  Result<ReviewThread, ReviewThreadFailure | TokenUnreadableFailure>
>;

export interface PostedThreads {
  readonly landed: PublishComment[];
  readonly rejected: PublishComment[];
}

export type PostThreadsFailure = GitHubApiError | TokenUnreadableFailure;
