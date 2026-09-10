import type { ValueOf } from "persistence";
import type { RepoId, ScopeContext } from "persistence";
import type { CreateReviewError } from "github";
import type { Logger } from "logging";
import type {
  GitHubDeniedFailure,
  TokenUnreadableFailure,
} from "../../../../shared-errors/failures";
import type { ReviewerGitHubClient } from "../../../auth/reviewer-github-client";

/** Narrow slice: the per-request reviewer channel plus the request log. */
export interface ReviewControllerDeps {
  readonly github: ReviewerGitHubClient;
  readonly log: Logger;
}

/**
 * The viewer's own pending review on GitHub carries comments they have not
 * sent; the route never deletes that for them.
 */
export interface PendingReviewHeldFailure {
  readonly kind: "pending-review-held";
  readonly commentCount: number;
}

export type SubmitFailure =
  | TokenUnreadableFailure
  | GitHubDeniedFailure<CreateReviewError>
  | PendingReviewHeldFailure;

export type EvictConversation = (
  ctx: ScopeContext,
  repoId: RepoId,
  prNumber: number,
) => void;

/** The FE's outcome vocabulary; the values ride the wire. */
export const ReviewOutcomes = {
  COMMENT: "comment",
  APPROVE: "approve",
  REQUEST_CHANGES: "request-changes",
} as const;
export type ReviewOutcome = ValueOf<typeof ReviewOutcomes>;
