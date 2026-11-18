// The PR conversation's wire shapes: the conversation and collaborator reads,
// and what the comment writes send and answer. Ids are GitHub REST database
// ids; optional keys are absent, never null.
import type {
  ReviewCommentSide,
  ReviewVerdictState,
  ThreadSubjectType,
} from "types";

export interface ConversationAuthorView {
  /** `"ghost"` when the account was deleted. */
  readonly login: string;
  readonly isBot: boolean;
  /** Absent only for a ghost author. */
  readonly avatarUrl?: string;
}

export interface ConversationCommentView {
  readonly commentId: number;
  readonly author: ConversationAuthorView;
  readonly body: string;
  /** ISO-8601. */
  readonly createdAt: string;
  readonly url: string;
  /** The formal review the comment belongs to: the own-comment join key. */
  readonly reviewId?: number;
}

export interface ConversationThreadView {
  /** The first comment's id: the thread's identity and the reply target. */
  readonly rootCommentId: number;
  readonly path: string;
  /** End line on the current diff; absent for an outdated or file-level thread. */
  readonly line?: number;
  /** First line of a multi-line anchor. */
  readonly startLine?: number;
  readonly side?: ReviewCommentSide;
  readonly startSide?: ReviewCommentSide;
  readonly subjectType: ThreadSubjectType;
  readonly isResolved: boolean;
  readonly isOutdated: boolean;
  /** The commit the thread was anchored on. */
  readonly anchorSha?: string;
  /** Chronological; index 0 is the root comment. */
  readonly comments: readonly ConversationCommentView[];
  readonly hasMoreComments: boolean;
}

export interface ConversationReviewView {
  readonly reviewId: number;
  readonly author: ConversationAuthorView;
  readonly state: ReviewVerdictState;
  readonly body: string;
  readonly submittedAt?: string;
  readonly url: string;
}

/** A PR-level comment on the conversation timeline. */
export interface PrLevelCommentView {
  readonly commentId: number;
  readonly author: ConversationAuthorView;
  readonly body: string;
  readonly createdAt: string;
  readonly url: string;
}

/** `read-conversation`. */
export interface ConversationResponse {
  readonly threads: readonly ConversationThreadView[];
  readonly reviews: readonly ConversationReviewView[];
  readonly prComments: readonly PrLevelCommentView[];
  readonly hasMoreThreads: boolean;
  readonly hasMoreReviews: boolean;
  readonly hasMorePrComments: boolean;
}

export interface CollaboratorView {
  readonly login: string;
  /** Absent when the user never set a display name. */
  readonly name?: string;
  readonly avatarUrl: string;
}

/** `list-collaborators`. */
export interface CollaboratorsResponse {
  readonly collaborators: readonly CollaboratorView[];
  readonly hasMore: boolean;
}

/** `create-inline-comment`: the session draft to post now. */
export interface CreateInlineCommentBody {
  readonly draftId: string;
}

/** `reply-to-comment`. */
export interface ReplyToCommentBody {
  readonly body: string;
}

/** What `create-inline-comment` and `reply-to-comment` answer, with 201. */
export interface PostedCommentResponse {
  readonly commentId: number;
  /** The review GitHub wrapped the comment in; absent when it assigns none. */
  readonly reviewId?: number;
}

/** What `resolve-thread` and `unresolve-thread` answer. */
export interface ThreadResolutionResponse {
  /** The direction the route sets, echoed. */
  readonly resolved: boolean;
  /** The thread was already in that state; still a success. */
  readonly alreadyInTargetState: boolean;
}
