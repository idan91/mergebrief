import type { RepoId, ScopeContext } from "persistence";
import type { ReviewOutcome } from "types/reviews";
import type { Result } from "types/utils";
import type { PublishedReview, ReviewPublishFailure } from "../publish/types";
import type { ResolvedSessionWrite } from "../session/logic/session-writes";
import type { SessionWriteFailure } from "../session/types";

export type EvictConversation = (
  ctx: ScopeContext,
  repoId: RepoId,
  prNumber: number,
) => void;

/** A held draft lost its place; posting it would land on unrelated lines. */
export interface DraftAnchorOrphanedFailure {
  readonly kind: "draft-anchor-orphaned";
}

/**
 * A deterministic refusal the FE mirrors: a neutral review with nothing to
 * say, or drafts whose worst-case fold would pass GitHub's body cap.
 */
export interface SubmitInvalidFailure {
  readonly kind: "submit-invalid";
}

/** `github-denied` at `resolve` is the fresh repo read, else a review call. */
export type SubmitReviewFailure =
  | SessionWriteFailure
  | DraftAnchorOrphanedFailure
  | SubmitInvalidFailure
  | ReviewPublishFailure;

export type SubmitReviewResult = Result<PublishedReview, SubmitReviewFailure>;

export interface SubmitReviewRequest {
  /** Bound to the Brief the request names; it answers before GitHub does. */
  readonly session: ResolvedSessionWrite;
  readonly outcome: ReviewOutcome;
  readonly body: string | undefined;
  /** The named Brief's head, the commit every thread pins to. */
  readonly commitId: string;
}
