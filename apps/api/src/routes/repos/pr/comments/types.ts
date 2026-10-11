import type {
  GitHubCallFailure,
  InlineReviewCommentResult,
  ReviewCommentReplyResult,
  ReviewerRepoClient,
  SetReviewThreadResolutionResult,
} from "github";
import type { Logger } from "logging";
import type { RepoId, ScopeContext } from "persistence";
import type { Result } from "types/utils";
import type { GitHubDeniedFailure } from "../../../../shared-errors/failures";
import type { PublishExpiredFailure } from "../publish/types";
import type { ResolvedSessionWrite } from "../session/logic/session-writes";
import type { BriefSpan } from "../session/schemas";
import type { SessionWriteFailure } from "../session/types";

/** `resolve` is the fresh repo read, `mutation` the write or an in-doubt read. */
export type CommentDeniedFailure = GitHubDeniedFailure<GitHubCallFailure>;

/**
 * An in-doubt check that could not tell whether GitHub holds the draft, or
 * found it folded into a review or held in a pending one: the claim stays,
 * and the reviewer decides.
 */
export interface PublishInDoubtFailure {
  readonly kind: "publish-in-doubt";
}

/** Another draft of this one's claim is on GitHub: its review carried both. */
export interface SiblingPublishedFailure {
  readonly kind: "sibling-published";
}

export type PostNowFailure =
  | SessionWriteFailure
  | CommentDeniedFailure
  | PublishInDoubtFailure
  | SiblingPublishedFailure
  | PublishExpiredFailure;

export type PostNowResult = Result<InlineReviewCommentResult, PostNowFailure>;

export interface PostNowRequest {
  /** Bound to the Brief the request names; it answers before GitHub does. */
  readonly session: ResolvedSessionWrite;
  readonly draftId: bigint;
  /** The named Brief's head, the commit the comment pins to. */
  readonly commitId: string;
}

/** What an in-doubt check reads with: the viewer's own client and session. */
export interface InDoubtCheck {
  readonly log: Logger;
  readonly session: ResolvedSessionWrite;
  readonly repo: ReviewerRepoClient;
  readonly prNumber: number;
  readonly viewerId: bigint;
}

export interface ReplyInput {
  readonly commentId: number;
  readonly body: string;
  /** The Brief the reply was written from; absent records nothing. */
  readonly span?: BriefSpan;
}

export type ReplyResult = Result<
  ReviewCommentReplyResult,
  CommentDeniedFailure
>;

export interface ResolutionInput {
  readonly rootCommentId: number;
  readonly resolved: boolean;
}

export type ResolutionResult = Result<
  SetReviewThreadResolutionResult,
  CommentDeniedFailure
>;

export type EvictConversation = (
  ctx: ScopeContext,
  repoId: RepoId,
  prNumber: number,
) => void;
