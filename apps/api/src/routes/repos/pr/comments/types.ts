import type { RepoId, ScopeContext } from "persistence";
import type { GitHubApiError } from "github";
import type {
  GitHubDeniedFailure,
  TokenUnreadableFailure,
} from "../../../../shared-errors/failures";
import type { ReviewerGitHubClient } from "../../../auth/reviewer-github-client";

/** Narrow slice: the per-request reviewer channel is the only dependency. */
export interface CommentsControllerDeps {
  readonly github: ReviewerGitHubClient;
}

export type ReplyFailure =
  | TokenUnreadableFailure
  | GitHubDeniedFailure<GitHubApiError>;

export type ResolutionFailure =
  | TokenUnreadableFailure
  | GitHubDeniedFailure<GitHubApiError>;

/** The repo, PR and reviewed head a post-now comment is pinned to. */
export interface PublishPin {
  readonly repoId: RepoId;
  readonly prNumber: number;
  readonly commitId: string;
}

export type EvictConversation = (
  ctx: ScopeContext,
  repoId: RepoId,
  prNumber: number,
) => void;
