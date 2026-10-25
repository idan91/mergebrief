import type { RepoId } from "persistence";
import type { RepoIdentity } from "brief-core/pr-stack";

export interface PullRequestRef {
  readonly owner: string;
  readonly repo: string;
  readonly prNumber: number;
}

export interface CompareDiffRef {
  readonly owner: string;
  readonly repo: string;
  /** The span endpoints, any two refs (SHAs/branches) GitHub can compare. */
  readonly base: string;
  readonly head: string;
}

export interface PullRequestInfo {
  /** The base repo's immutable numeric id, the row key the doors upsert by. */
  readonly repoId: RepoId;
  /** The base repo's `owner/name` as GitHub verified it (rename-proof-ish). */
  readonly repoFullName: string;
  readonly headSha: string;
  /** Head branch name, as GitHub reports it. */
  readonly headRef: string;
  readonly baseSha: string;
  /** Base branch name; omitted when GitHub sends none or empty. */
  readonly baseRef?: string;
  /** GitHub PR state (`open` / `closed`). */
  readonly state: string;
  readonly draft: boolean;
  /** Whether the PR has been merged (a merged PR's `state` is `closed`). */
  readonly merged: boolean;
  readonly title: string;
  /** PR description body; GitHub sends null for an empty description. */
  readonly body: string;
  /** The PR's html page URL (generation metadata, never fetched from). */
  readonly htmlUrl: string;
  /** Number of commits on the PR at this head. */
  readonly commitCount: number;
  /** PR author login; null when the account is gone. */
  readonly authorLogin: string | null;
  /** The PR author's account is a `Bot`; false when the account is gone. */
  readonly authorIsBot: boolean;
  /** When the PR closed/merged; null while open. */
  readonly closedAt: Date | null;
  /** GitHub's `updated_at`, the Inbox's default sort key. */
  readonly updatedAt: Date;
  readonly headRepo?: RepoIdentity;
  readonly baseRepo?: RepoIdentity;
}

/** One changed file's path + churn, as the generation inputs need it. */
export interface PullRequestFile {
  readonly path: string;
  readonly additions: number;
  readonly deletions: number;
}

export interface RepositoryRef {
  readonly owner: string;
  readonly repo: string;
}

export interface CommitRef {
  readonly owner: string;
  readonly repo: string;
  /** A commit-ish (possibly abbreviated SHA) to resolve. */
  readonly ref: string;
}
