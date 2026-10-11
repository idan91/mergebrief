import type {
  AddReviewThreadInput,
  AuthoredReview,
  GitHubCall,
  GitHubCallFailure,
  InlineReviewCommentResult,
  ListedReviewComment,
  PendingReview,
  ReviewCommentSide,
  ReviewerRepoClient,
  ReviewSubjectTypes,
  ReviewThread,
} from "github";
import type { Logger } from "logging";
import type {
  ReleaseClaimInput,
  ReviewDraftCommentRow,
  SettleClaimInput,
} from "persistence";
import type { ReviewOutcome } from "types/reviews";
import type { Result } from "types/utils";
import type { GitHubDeniedFailure } from "../../../../shared-errors/failures";
import type { SessionWriteFailure } from "../session/types";

/** The viewer's client on the freshly resolved repository, plus the request log. */
export interface PublishDeps {
  readonly repo: ReviewerRepoClient;
  readonly log: Logger;
}

/** The PR and reviewed head every published comment pins to, on a bound repo client. */
export interface CommentPin {
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

/** What the anchor mapper reads off a stored draft. */
export type PublishableDraft = Pick<ReviewDraftCommentRow, "anchor" | "body">;

/** The session bookkeeping a publish attempt answers to once GitHub has. */
export interface ClaimLedger {
  settle(input: SettleClaimInput): Promise<Result<number, SessionWriteFailure>>;
  release(
    input: ReleaseClaimInput,
  ): Promise<Result<number, SessionWriteFailure>>;
}

/** What an in-doubt check asks GitHub about: `viewerId`'s writes since a claim. */
export interface InDoubtQuery {
  readonly viewerId: bigint;
  /** When the attempt that may have written began. */
  readonly claimedAt: Date;
}

/** In-doubt drafts to look for on GitHub, the first to match winning. */
export interface PostedCommentQuery<
  Draft extends PublishableDraft,
> extends InDoubtQuery {
  readonly drafts: readonly Draft[];
  /** A listed comment in one of these still PENDING is held, never published. */
  readonly viewerReviews: readonly AuthoredReview[];
}

/** The draft GitHub holds a comment for, and that comment. */
export interface PostedCommentMatch<Draft extends PublishableDraft> {
  readonly draft: Draft;
  readonly posted: InlineReviewCommentResult;
}

/** Listed review comments, split by whether a viewer's pending review holds them. */
export interface PartitionedReviewComments {
  readonly published: ListedReviewComment[];
  readonly pending: ListedReviewComment[];
}

/**
 * `draft-in-pending-review`: no draft is published, but one sits unsent in a
 * viewer's pending review, which submitting on GitHub would post.
 */
export type PostedCommentLookupFailure =
  | GitHubDeniedFailure<GitHubCallFailure>
  | { readonly kind: "listing-incomplete" }
  | { readonly kind: "draft-in-pending-review" };

/** `undefined` when GitHub holds a comment for none of the drafts. */
export type PostedCommentLookupResult<Draft extends PublishableDraft> = Result<
  PostedCommentMatch<Draft> | undefined,
  PostedCommentLookupFailure
>;

export type ViewerReviewListResult = Result<
  readonly AuthoredReview[],
  GitHubCallFailure
>;

export type CommentPublishFailure = GitHubDeniedFailure<GitHubCallFailure>;

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

/**
 * The submit mutation failed and the review list could not be read, so
 * whether the review went out is unknown.
 */
export interface SubmitUnconfirmedFailure {
  readonly kind: "submit-unconfirmed";
}

/**
 * The claim's write deadline passed before a thread or the submit mutation;
 * the pending review was discarded and nothing was published.
 */
export interface PublishExpiredFailure {
  readonly kind: "publish-expired";
}

export type ReviewPublishFailure =
  | GitHubDeniedFailure<GitHubCallFailure>
  | PendingReviewHeldFailure
  | SubmitUnconfirmedFailure
  | PublishExpiredFailure;

export interface ReviewPublishInput {
  readonly pin: CommentPin;
  readonly outcome: ReviewOutcome;
  readonly body: string | undefined;
  readonly drafts: readonly PublishableDraft[];
  /** No thread or submit leaves after this; see `deriveWriteDeadline`. */
  readonly writeDeadline: Date;
}

export interface PublishedReview {
  readonly reviewId: bigint;
  readonly commentsFolded: number;
  readonly commentsTotal: number;
}

export type ReviewPublishResult = Result<PublishedReview, ReviewPublishFailure>;

export type PendingReviewResult = Result<
  PendingReview,
  GitHubCallFailure | PendingReviewHeldFailure
>;

/** One thread mutation on the viewer's retry-off client. */
export type PostThread = (
  input: AddReviewThreadInput,
) => GitHubCall<ReviewThread>;

export interface PostedThreads {
  readonly landed: PublishComment[];
  readonly rejected: PublishComment[];
}

export type PostThreadsFailure = GitHubCallFailure | PublishExpiredFailure;
