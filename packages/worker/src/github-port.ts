// The worker's GitHub seam: the four reads a generate job needs, pre-bound to
// one PR so the task logic never handles octokit instances or repo
// coordinates. The REAL implementation mints an installation-scoped client
// via `github`'s App auth (ADR 0016 trust boundary — the worker acts as the
// App, never as a user); tests substitute an in-memory port.
import {
  fetchCompareDiff,
  fetchDiff,
  fetchPullRequest,
  fetchPullRequestFiles,
  getInstallationClient,
  type AppClient,
  type GitHubApiError,
  type PullRequestFile,
  type PullRequestInfo,
} from "github";
import type { InstallationId } from "persistence";
import type { Result } from "types";

export type { GitHubApiError, PullRequestFile, PullRequestInfo };

/** The reads a generate job performs, bound to one (installation, repo, PR). */
export interface PullRequestSource {
  fetchPullRequest(): Promise<Result<PullRequestInfo, GitHubApiError>>;
  fetchPullRequestFiles(): Promise<Result<PullRequestFile[], GitHubApiError>>;
  /** The whole-PR unified diff at the current head. */
  fetchDiff(): Promise<Result<string, GitHubApiError>>;
  /** The `base...head` span diff (narrative/marks/delta inputs). */
  fetchCompareDiff(base: string, head: string): Promise<Result<string, GitHubApiError>>;
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
export function splitRepoSlug(slug: string): { owner: string; repo: string } | undefined {
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
        throw new Error(`malformed repo slug on pull_request row (number ${prNumber})`);
      }
      const octokit = await getInstallationClient(app, installationId);
      const ref = { owner: split.owner, repo: split.repo, prNumber };
      return {
        fetchPullRequest: () => fetchPullRequest(octokit, ref),
        fetchPullRequestFiles: () => fetchPullRequestFiles(octokit, ref),
        fetchDiff: () => fetchDiff(octokit, ref),
        fetchCompareDiff: (base, head) =>
          fetchCompareDiff(octokit, { owner: ref.owner, repo: ref.repo, base, head }),
      };
    },
  };
}
