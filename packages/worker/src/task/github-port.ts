// The worker's GitHub seam: the four reads a generate job needs, pre-bound to
// one PR so the task logic never handles octokit instances or repo
// coordinates. The REAL implementation mints an installation-scoped client
// via `github`'s App auth (ADR 0016 trust boundary — the worker acts as the
// App, never as a user); tests substitute an in-memory port.
import {
  deleteComment,
  fetchComment,
  fetchCompareDiff,
  fetchDiff,
  fetchPullRequest,
  fetchPullRequestFiles,
  getInstallationClient,
  getRepoFile,
  postEntryComment,
  type AppClient,
  type GitHubApiError,
  type PullRequestFile,
  type PullRequestInfo,
  type RepoFileResult,
} from "github";
import type { InstallationId } from "persistence";
import type { Result } from "types";

export type {
  GitHubApiError,
  PullRequestFile,
  PullRequestInfo,
  RepoFileResult,
};

/** The GitHub calls a generate job performs, bound to one (installation, repo, PR). */
export interface PullRequestSource {
  fetchPullRequest(): Promise<Result<PullRequestInfo, GitHubApiError>>;
  fetchPullRequestFiles(): Promise<Result<PullRequestFile[], GitHubApiError>>;
  /** The whole-PR unified diff at the current head. */
  fetchDiff(): Promise<Result<string, GitHubApiError>>;
  /** The `base...head` span diff (narrative/marks/delta inputs). */
  fetchCompareDiff(
    base: string,
    head: string,
  ): Promise<Result<string, GitHubApiError>>;
  /**
   * One repo file from the DEFAULT BRANCH (`ref` deliberately unset — the
   * contents API's default-branch semantics ARE the ADR 0032 #3 trust rule;
   * a PR head must never be able to weaken its own scrutiny).
   */
  fetchRepoFile(
    path: string,
    maxBytes: number,
  ): Promise<Result<RepoFileResult, GitHubApiError>>;
  /** Post the branded Entry comment (ADR 0016 #3); returns the comment id. */
  postEntryComment(
    body: string,
  ): Promise<Result<{ readonly commentId: bigint }, GitHubApiError>>;
  /** Delete a prior Entry comment; a 404 (already gone) maps to ok. */
  deleteComment(commentId: bigint): Promise<Result<void, GitHubApiError>>;
  /** Read a prior Entry comment's live body; a 404 (gone) maps to ok undefined. */
  fetchComment(
    commentId: bigint,
  ): Promise<Result<{ readonly body: string } | undefined, GitHubApiError>>;
}

export interface GitHubPort {
  /**
   * Bind a source to one PR. `repoSlug` is the stored `owner/repo` full name;
   * minting the installation token is the only network side effect.
   */
  forPullRequest(
    installationId: InstallationId,
    repoSlug: string,
    prNumber: number,
  ): Promise<PullRequestSource>;
}

/** Split a stored `owner/repo` slug; `undefined` when malformed. */
export function splitRepoSlug(
  slug: string,
): { owner: string; repo: string } | undefined {
  const parts = slug.split("/");
  const [owner, repo] = parts;
  if (parts.length !== 2 || !owner || !repo) {
    return undefined;
  }
  return { owner, repo };
}

/** The production port over `github`'s App-JWT client. */
export function appGitHubPort(app: AppClient): GitHubPort {
  return {
    async forPullRequest(installationId, repoSlug, prNumber) {
      const split = splitRepoSlug(repoSlug);
      if (split === undefined) {
        // Programmer/data error: the slug came from our own row.
        throw new Error(
          `malformed repo slug on pull_request row (number ${prNumber})`,
        );
      }
      const octokit = await getInstallationClient(app, installationId);
      const ref = { owner: split.owner, repo: split.repo, prNumber };
      return {
        fetchPullRequest: () => fetchPullRequest(octokit, ref),
        fetchPullRequestFiles: () => fetchPullRequestFiles(octokit, ref),
        fetchDiff: () => fetchDiff(octokit, ref),
        fetchCompareDiff: (base, head) =>
          fetchCompareDiff(octokit, {
            owner: ref.owner,
            repo: ref.repo,
            base,
            head,
          }),
        fetchRepoFile: (path, maxBytes) =>
          getRepoFile(octokit, {
            owner: ref.owner,
            repo: ref.repo,
            path,
            maxBytes,
          }),
        postEntryComment: (body) =>
          postEntryComment(octokit, {
            owner: ref.owner,
            repo: ref.repo,
            prNumber,
            body,
          }),
        deleteComment: (commentId) =>
          deleteComment(octokit, {
            owner: ref.owner,
            repo: ref.repo,
            commentId,
          }),
        fetchComment: (commentId) =>
          fetchComment(octokit, {
            owner: ref.owner,
            repo: ref.repo,
            commentId,
          }),
      };
    },
  };
}
