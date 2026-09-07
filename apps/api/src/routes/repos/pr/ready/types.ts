import type { GitHubApiError } from "github";
import type {
  GitHubDeniedFailure,
  TokenUnreadableFailure,
} from "../../../../shared-errors/failures";
import type { ReviewerGitHubClient } from "../../../auth/reviewer-github-client";

/** Narrow slice: the per-request reviewer channel is the only dependency. */
export interface ReadyControllerDeps {
  readonly github: ReviewerGitHubClient;
}

export type MarkReadyFailure =
  | TokenUnreadableFailure
  | GitHubDeniedFailure<GitHubApiError>;
