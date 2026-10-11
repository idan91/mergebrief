import type { GitHubCallFailure, GitHubReader } from "github";
import type { Logger } from "logging";
import type { AppDatabase, PullRequestRowId } from "persistence";
import type { GitHubDeniedFailure } from "../../shared-errors/failures";

/** Narrow slices only, never `AppDeps`. */
export interface GenerateBriefDeps {
  readonly handle: AppDatabase;
  /**
   * The operator's read-only GitHub for a listed reviewer: a GitHub App user
   * token cannot read a private repo the App is not installed on, even for
   * the repo's owner. Asked once, only after the viewer's read is denied.
   */
  readonly operator: GitHubReader | undefined;
  /** Operator-facing lines only: a rejected operator credential. */
  readonly log: Logger;
}

/** The paste's one GitHub read, refused; the handler owns the posture. */
export type GenerateFailure = GitHubDeniedFailure<GitHubCallFailure>;

/** What the door returns: where the brief will render, for polling. */
export interface GenerateAccepted {
  readonly repoId: string;
  readonly prNumber: number;
}

/** The operation's result: the wire shape plus the audit-stamp row id. */
export interface GenerateOutcome extends GenerateAccepted {
  readonly pullRequestId: PullRequestRowId;
}
