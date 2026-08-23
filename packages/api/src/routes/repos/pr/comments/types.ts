import type { InstallationId, RepoId } from "persistence";
import type { GitHubApiError, InlineReviewCommentError } from "github";
import type {
  GitHubDeniedFailure,
  TokenUnreadableFailure,
} from "../../../../shared-errors/failures";
import type { ReviewerGitHubClient } from "../../../auth/reviewer-github-client";

/** Narrow slice: the per-request reviewer channel is the only dependency. */
export interface CommentsControllerDeps {
  readonly github: ReviewerGitHubClient;
}

export type RepoResolveFailure =
  | TokenUnreadableFailure
  | GitHubDeniedFailure<GitHubApiError>;

export type PublishFailure =
  | TokenUnreadableFailure
  | GitHubDeniedFailure<InlineReviewCommentError>;

export type ReplyFailure =
  | TokenUnreadableFailure
  | GitHubDeniedFailure<GitHubApiError>;

export type ResolutionFailure =
  | TokenUnreadableFailure
  | GitHubDeniedFailure<GitHubApiError>;

export interface RepoTarget {
  readonly owner: string;
  readonly repo: string;
}

export type EvictConversation = (
  installationId: InstallationId,
  repoId: RepoId,
  prNumber: number,
) => void;
