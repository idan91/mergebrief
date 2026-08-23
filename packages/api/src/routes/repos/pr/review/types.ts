import type { ValueOf } from "persistence";
import type { InstallationId, RepoId } from "persistence";
import type { CreateReviewError } from "github";
import type {
  GitHubDeniedFailure,
  TokenUnreadableFailure,
} from "../../../../shared-errors/failures";
import type { ReviewerGitHubClient } from "../../../auth/reviewer-github-client";

/** Narrow slice: the per-request reviewer channel is the only dependency. */
export interface ReviewControllerDeps {
  readonly github: ReviewerGitHubClient;
}

export type SubmitFailure =
  | TokenUnreadableFailure
  | GitHubDeniedFailure<CreateReviewError>;

export type EvictConversation = (
  installationId: InstallationId,
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
